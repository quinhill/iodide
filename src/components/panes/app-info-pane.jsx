import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'

import SidePane from './side-pane'

// import DeclaredVariables from '../declared-variables'
import tasks from '../../actions/task-definitions'

export class AppInfoPaneUnconnected extends React.Component {
  static propTypes = {
    appMessages: PropTypes.array,
  }
  render() {
    /* eslint-disable */
    const messageDivs = this.props.appMessages
      .map((msg, i) => (
        <div
          className="app-info-message"
          key={`msg-${msg.id}`}
        >
          <div className='app-message-details' dangerouslySetInnerHTML={{ __html: msg.details }} />
          <div className='app-message-when'>{msg.when}</div>
        </div>
      ))
    /* eslint-enable */
    return (
      <SidePane task={tasks.toggleAppInfoPane} title="App info" openOnMode="_APP_INFO">
        {messageDivs}
      </SidePane>
    )
  }
}

export function mapStateToProps(state) {
  const appMessages = state.appMessages.slice()
  appMessages.reverse()
  appMessages.sort((a, b) => {
    if (Date.parse(a.when) > Date.parse(b.when)) return -1
    return 1
  })
  return {
    appMessages,
    sidePaneMode: state.sidePaneMode,
  }
}

export default connect(mapStateToProps)(AppInfoPaneUnconnected)
