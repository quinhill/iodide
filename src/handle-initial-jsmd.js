import { stateFromJsmd } from './tools/jsmd-tools'
import handleUrlQuery from './tools/handle-url-query'
import { updateAppMessages, importInitialJsmd, evaluateAllCells } from './actions/actions'

export default async function handleInitialJsmd(store) {
  let state
  if (window.location.search) {
    // if there is a query string, handle it and skip parsing the local jsmd
    state = await handleUrlQuery()
  } else {
    // if there is no query string, attempt to parse jsmd from html
    const jsmdElt = document.getElementById('jsmd')
    if (jsmdElt &&
        jsmdElt.innerHTML &&
        jsmdElt.innerHTML.trim() !== '') {
      state = stateFromJsmd(jsmdElt.innerHTML)
    }
  }
  console.log('INITIAL JSMD STATE', state)
  if (state !== undefined) {
    store.dispatch(importInitialJsmd(state))
    if (window.location.search) {
      store.dispatch(updateAppMessages({ message: 'Notebook imported from URL.' }))
    }
    if (state.viewMode === 'REPORT_VIEW') {
      store.dispatch(evaluateAllCells())
    }
  }
}
// export { handleInitialJsmd }
