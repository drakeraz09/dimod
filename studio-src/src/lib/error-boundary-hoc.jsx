import React from 'react';
import ErrorBoundary from '../containers/error-boundary.jsx';

const ErrorBoundaryHOC = function (action, options){
    /**
     * The function to be called with a React component to wrap it.
     * @param {React.Component} WrappedComponent - Component to wrap with an error boundary.
     * @returns {React.Component} the component wrapped with an error boundary.
     */
    return function (WrappedComponent) {
        const ErrorBoundaryWrapper = props => (
            <ErrorBoundary
                action={action}
                {...options}
            >
                <WrappedComponent {...props} />
            </ErrorBoundary>
        );
        return ErrorBoundaryWrapper;
    };
};

export default ErrorBoundaryHOC;
