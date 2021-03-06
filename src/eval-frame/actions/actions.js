import MarkdownIt from 'markdown-it'
import MarkdownItKatex from 'markdown-it-katex'
import MarkdownItAnchor from 'markdown-it-anchor'

import {
  getCellById,
  // isCommandMode
} from '../tools/notebook-utils'
import {
  addExternalDependency,
  getSelectedCell,
} from '../reducers/output-reducer-utils'

import { waitForExplicitContinuationStatusResolution } from '../iodide-api/evalQueue'
import { postMessageToEditor } from '../port-to-editor'

let evaluationQueue = Promise.resolve()

const MD = MarkdownIt({ html: true })
MD.use(MarkdownItKatex).use(MarkdownItAnchor)

const CodeMirror = require('codemirror') // eslint-disable-line

function IdFactory() {
  this.state = 0
  this.nextId = () => {
    this.state += 1
    return this.state
  }
}

const historyIdGen = new IdFactory()

export function newNotebook() {
  // we still need this for some tests to work, even though it's not really used
  return {
    type: 'NEW_NOTEBOOK',
  }
}

export function temporarilySaveRunningCellID(cellId) {
  return {
    type: 'TEMPORARILY_SAVE_RUNNING_CELL_ID',
    cellId,
  }
}


export function appendToEvalHistory(cellId, content, value, historyOptions = {}) {
  // const cellType = historyOptions.cellType === undefined ?
  //   'code' : historyOptions.cellType
  const historyId = historyOptions.historyId === undefined ?
    historyIdGen.nextId() : historyOptions.historyId
  const historyType = historyOptions.historyType === undefined ?
    'CELL_EVAL_VALUE' : historyOptions.historyType

  // returned obj must match history schema
  return {
    type: 'APPEND_TO_EVAL_HISTORY',
    cellId,
    // cellType,
    content,
    historyId,
    historyType,
    lastRan: Date.now(),
    value,
  }
}

export function updateValueInHistory(historyId, value) {
  return {
    type: 'UPDATE_VALUE_IN_HISTORY',
    historyId,
    value,
  }
}

export function updateAppMessages(messageObj) {
  const { message } = messageObj
  let { details, when } = messageObj
  if (when === undefined) when = new Date().toString()
  if (details === undefined) details = message
  return {
    type: 'UPDATE_APP_MESSAGES',
    message: { message, details, when },
  }
}

// note: this function is NOT EXPORTED. It is a private function meant
// to be wrapped by other actions that will configure and dispatch it.
export function updateCellProperties(cellId, updatedProperties) {
  return {
    type: 'UPDATE_CELL_PROPERTIES',
    cellId,
    updatedProperties,
  }
}

export function incrementExecutionNumber() {
  return {
    type: 'INCREMENT_EXECUTION_NUMBER',
  }
}
export function updateUserVariables() {
  return {
    type: 'UPDATE_USER_VARIABLES',
  }
}

function evaluateCodeCell(cell) {
  return (dispatch, getState) => {
    // this variable may get changed in eval.
    const state = getState()
    let output
    let evalStatus
    const code = cell.content
    const languageModule = state.languages[cell.language].module
    const { evaluator } = state.languages[cell.language]

    // clear stuff relating to the side effect target before evaling
    dispatch({ type: 'CELL_SIDE_EFFECT_STATUS', cellId: cell.id, hasSideEffect: false })
    // this is one place where we have to directly mutate the DOM b/c we need
    // this to happen outside of React's update schedule. see also iodide-api/output.js
    const sideEffectTarget = document.getElementById(`cell-${cell.id}-side-effect-target`)
    if (sideEffectTarget) { sideEffectTarget.innerHTML = '' }

    dispatch(temporarilySaveRunningCellID(cell.id))
    try {
      output = window[languageModule][evaluator](code)
    } catch (e) {
      output = e
      evalStatus = 'ERROR'
    }
    const updateCellAfterEvaluation = () => {
      const cellProperties = { rendered: true }
      if (evalStatus === 'ERROR') {
        cellProperties.evalStatus = evalStatus
      }
      dispatch(updateCellProperties(cell.id, cellProperties))
      // dispatch(incrementExecutionNumber())
      dispatch(appendToEvalHistory(cell.id, cell.content, output))
      dispatch(updateUserVariables())
    }

    const evaluation = Promise.resolve()
      .then(updateCellAfterEvaluation)
      .then(waitForExplicitContinuationStatusResolution)
      .then(() => dispatch(temporarilySaveRunningCellID(undefined)))
    return evaluation
  }
}

function evaluateMarkdownCell(cell) {
  return dispatch => dispatch(updateCellProperties(
    cell.id,
    {
      value: MD.render(cell.content),
      rendered: true,
      evalStatus: 'SUCCESS',
    },
  ))
}

function evaluateResourceCell(cell) {
  return (dispatch, getState) => {
    const externalDependencies = [...getState().externalDependencies]
    const dependencies = cell.content.split('\n').filter(d => d.trim().slice(0, 2) !== '//')
    const newValues = dependencies
      .filter(d => !externalDependencies.includes(d))
      .map(addExternalDependency)

    newValues.forEach((d) => {
      if (!externalDependencies.includes(d.src)) {
        externalDependencies.push(d.src)
      }
    })
    const evalStatus = newValues.map(d => d.status).includes('error') ? 'ERROR' : 'SUCCESS'
    dispatch(updateCellProperties(cell.id, { evalStatus }))
    dispatch(appendToEvalHistory(
      cell.id,
      `// added external dependencies:\n${newValues.map(s => `// ${s.src}`).join('\n')}`,
      new Array(...[...cell.value || [], ...newValues]),
      { historyType: 'CELL_EVAL_EXTERNAL_RESOURCE' },
    ))

    // dispatch(updateCellProperties(
    //   cell.id,
    //   {
    //     value: new Array(...[...cell.value || [], ...newValues]),
    //     rendered: true,
    //     evalStatus,
    //   },
    // ))
    // if (newValues.length) {
    //   dispatch(appendToEvalHistory(
    //     cell.id,
    //     `// added external dependencies:\n${newValues.map(s => `// ${s.src}`).join('\n')}`,
    //   ))
    // }
    dispatch(updateUserVariables())
  }
}

function evaluateCSSCell(cell) {
  return (dispatch) => {
    dispatch(updateCellProperties(
      cell.id,
      {
        value: cell.content,
        rendered: true,
        evalStatus: 'SUCCESS',
      },
    ))
    dispatch(appendToEvalHistory(
      cell.id,
      cell.content,
      'Page styles updated',
      { historyType: 'CELL_EVAL_INFO' },
    ))
  }
}

export function addLanguage(languageDefinition) {
  return {
    type: 'ADD_LANGUAGE_TO_EVAL_FRAME',
    languageDefinition,
  }
}

function evaluateLanguagePluginCell(cell) {
  return (dispatch) => {
    let pluginData
    let value
    let evalStatus
    let languagePluginPromise
    const rendered = true
    try {
      pluginData = JSON.parse(cell.content)
    } catch (err) {
      value = `plugin definition failed to parse:\n${err.message}`
      evalStatus = 'ERROR'
    }
    const historyId = historyIdGen.nextId()
    // dispatch(appendToEvalHistory(cell.id, cell.content, historyId))
    dispatch(appendToEvalHistory(
      cell.id,
      cell.content,
      value,
      { historyId, historyType: 'CELL_EVAL_INFO' },
    ))

    if (pluginData.url === undefined) {
      value = 'plugin definition missing "url"'
      evalStatus = 'ERROR'
      // dispatch(updateCellProperties(cell.id, { value, evalStatus, rendered }))
      dispatch(updateCellProperties(cell.id, { evalStatus, rendered }))
      dispatch(updateValueInHistory(historyId, value))
    } else {
      const {
        url,
        // keybinding,
        // languageId,
        // codeMirrorMode,
        displayName,
      } = pluginData

      languagePluginPromise = new Promise((resolve, reject) => {
        const xhrObj = new XMLHttpRequest()

        xhrObj.addEventListener('progress', (evt) => {
          value = `downloading plugin: ${evt.loaded} bytes loaded`
          if (evt.total > 0) {
            value += `out of ${evt.total} (${evt.loaded / evt.total}%)`
          }
          evalStatus = 'ASYNC_PENDING'
          // dispatch(updateCellProperties(cell.id, { value, evalStatus, rendered }))
          dispatch(updateCellProperties(cell.id, { evalStatus, rendered }))
          dispatch(updateValueInHistory(historyId, value))
        })

        xhrObj.addEventListener('load', () => {
          value = `${displayName} plugin downloaded, initializing`
          // dispatch(updateCellProperties(cell.id, { value, evalStatus, rendered }))
          dispatch(updateCellProperties(cell.id, { evalStatus, rendered }))
          dispatch(updateValueInHistory(historyId, value))
          // see the following for asynchronous loading of scripts from strings:
          // https://developer.mozilla.org/en-US/docs/Games/Techniques/Async_scripts

          // Here, we wrap whatever the return value of the eval into a promise.
          // If it is simply evaling a code block, then it returns undefined.
          // But if it returns a Promise, then we can wait for that promise to resolve
          // before we continue execution.
          const pr = Promise.resolve(window
            .eval(xhrObj.responseText)) // eslint-disable-line no-eval

          pr.then(() => {
            value = `${displayName} plugin ready`
            evalStatus = 'SUCCESS'
            dispatch(addLanguage(pluginData))
            postMessageToEditor('POST_LANGUAGE_DEF_TO_EDITOR', pluginData)
            // dispatch(updateCellProperties(cell.id, { value, evalStatus, rendered }))
            dispatch(updateCellProperties(cell.id, { evalStatus, rendered }))
            dispatch(updateValueInHistory(historyId, value))
            resolve()
          })
        })

        xhrObj.addEventListener('error', () => {
          value = `${displayName} plugin failed to load`
          evalStatus = 'ERROR'
          // dispatch(updateCellProperties(cell.id, { value, evalStatus, rendered }))
          dispatch(updateCellProperties(cell.id, { evalStatus, rendered }))
          dispatch(updateValueInHistory(historyId, value))
          reject()
        })

        xhrObj.open('GET', url, true)
        xhrObj.send()
      })
    }
    return languagePluginPromise
  }
}

export function evaluateCell(cellId) {
  return (dispatch, getState) => {
    dispatch(incrementExecutionNumber())
    let evaluation
    let cell
    if (cellId === undefined) {
      cell = getSelectedCell(getState())
    } else {
      cell = getCellById(getState().cells, cellId)
    }
    // here is where we should mark a cell as PENDING.
    if (cell.cellType === 'code') {
      evaluationQueue = evaluationQueue
        .then(() => dispatch(evaluateCodeCell(cell)))
      evaluation = evaluationQueue
    } else if (cell.cellType === 'markdown') {
      evaluation = dispatch(evaluateMarkdownCell(cell))
    } else if (cell.cellType === 'external dependencies') {
      evaluation = dispatch(evaluateResourceCell(cell))
    } else if (cell.cellType === 'css') {
      evaluation = dispatch(evaluateCSSCell(cell))
    } else if (cell.cellType === 'plugin') {
      if (JSON.parse(cell.content).pluginType === 'language') {
        evaluationQueue = evaluationQueue.then(() => dispatch(evaluateLanguagePluginCell(cell)))
        evaluation = evaluationQueue
      } else {
        // evaluation =
        // dispatch(updateAppMessages('No loader for plugin type or missing "pluginType" entry'))
      }
    } else {
      cell.rendered = false
    }
    return evaluation
  }
}

export function saveEnvironment(updateObj, update) {
  return {
    type: 'SAVE_ENVIRONMENT',
    updateObj,
    update,
  }
}

export function changePaneHeight(heightShift) {
  return {
    type: 'CHANGE_PANE_HEIGHT',
    heightShift,
  }
}
