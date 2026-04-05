import React from 'react';

/**
 * ErrorBoundary — catches any React or Three.js rendering errors
 * and shows a styled mission abort screen instead of a blank page.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Rendering error caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-space-black z-50">
          <div className="relative w-20 h-20 mb-8">
            <div className="absolute inset-0 rounded-full border-2 border-nasa-red/40 animate-ping" />
            <div className="absolute inset-0 rounded-full border-2 border-nasa-red flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-nasa-red" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
          </div>

          <h1 className="text-2xl font-bold text-nasa-red tracking-widest uppercase mb-2">
            Visualization Failure
          </h1>
          <p className="text-gray-400 text-sm max-w-md text-center mb-8 leading-relaxed">
            The mission control 3D environment encountered a critical error. Telemetry data is still being received.
          </p>

          <code className="text-xs text-red-400/70 bg-red-950/30 border border-red-900/40 px-4 py-3 rounded-lg max-w-lg text-center font-mono block">
            {this.state.error?.message || 'Unknown rendering error'}
          </code>

          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-8 px-6 py-2 border border-nasa-blue/50 text-nasa-blue text-sm font-bold tracking-wider uppercase hover:bg-nasa-blue/10 transition-colors rounded-lg"
          >
            Attempt Recovery
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
