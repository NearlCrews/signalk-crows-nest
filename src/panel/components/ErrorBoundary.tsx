/**
 * React class component error boundary. Catches render errors in its subtree
 * and displays a fallback UI so a single rendering failure does not unmount
 * the entire configuration panel. Built as a class component because React
 * error boundaries require `componentDidCatch` or `getDerivedStateFromError`,
 * which have no hook equivalent.
 */

import * as React from 'react'
import { Banner, Button, Stack } from 'signalk-nearlcrews-ui'

interface Props {
  children: React.ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor (props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError (error: Error): State {
    return { error }
  }

  override componentDidCatch (error: Error, info: React.ErrorInfo): void {
    console.error('Panel render error caught by ErrorBoundary:', error, info.componentStack)
  }

  override render (): React.ReactNode {
    if (this.state.error !== null) {
      return (
        <Stack gap={4}>
          <Banner live='assertive' tone='danger' title='Something went wrong'>
            {this.state.error.message}
          </Banner>
          <Button
            shape='pill'
            variant='secondary'
            onClick={() => window.location.reload()}
          >
            Reload
          </Button>
        </Stack>
      )
    }
    return this.props.children
  }
}
