// import { combineReducers } from 'redux'
import notebookReducer from './eval-frame-reducer'
import cellReducer from './output-reducer'

/*
It is suggested that using combineReducers, and following the standard
of having each reducer only function on a section of the state container,
might be a better approach. Redux makes it easy to refactor,
but we're not there quite yet. I'd rather simply decompose our reducers
so we can more manageably test them.
*/

function reduceReducers(...reducers) {
  return (previous, current) =>
    reducers.reduce(
      (p, r) => r(p, current),
      previous,
    )
}

export default reduceReducers(notebookReducer, cellReducer)
