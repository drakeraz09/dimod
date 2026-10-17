import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import log from './log';
import { getIsShowingProject } from '../reducers/project-state';

import {askAlert} from './dimod-ui';
import {isCloudProject} from './dimod-project';

const PACKAGER_URL = `${location.origin}/packager`;
const PACKAGER_ORIGIN = location.origin;

const PackagerIntegrationHOC = function (WrappedComponent) {
    class PackagerIntegrationComponent extends React.Component {
        constructor(props) {
            super(props);
            this.handleClickPackager = this.handleClickPackager.bind(this);
            this.handleMessage = this.handleMessage.bind(this);
        }
        componentDidMount() {
            window.addEventListener('message', this.handleMessage);
        }
        componentWillUnmount() {
            window.removeEventListener('message', this.handleMessage);
        }
        handleClickPackager() {
            if (!this.props.canOpenPackager) return;
            const runtime = this.props.vm && this.props.vm.runtime;
            if (isCloudProject() || (runtime && runtime.dimodServer)) {
                askAlert(
                    "Cloud projects can't be packaged: their server code and database run on Dimod's game server, " +
                    "which a packaged project can't reach.\n\nProjects that aren't cloud projects can be packaged, " +
                    'complex sprites and all.',
                    {title: "Can't package a cloud project"}
                );
                return;
            }
            window.open(`${PACKAGER_URL}/?import_from=${encodeURIComponent(location.origin)}`);
        }
        handleMessage(e) {
            if (e.origin !== PACKAGER_ORIGIN) {
                return;
            }

            if (!this.props.canOpenPackager) {
                return;
            }

            if (!e.data.p4) {
                return;
            }

            const packagerData = e.data.p4;
            if (packagerData.type !== 'ready-for-import') {
                return;
            }

            // The packager needs to know that we will be importing something so it can display a loading screen
            e.source.postMessage({
                p4: {
                    type: 'start-import'
                }
            }, e.origin);

            this.props.vm.saveProjectSb3('arraybuffer')
                .then(buffer => {
                    const name = `${this.props.reduxProjectTitle}.warp`;
                    e.source.postMessage({
                        p4: {
                            type: 'finish-import',
                            data: buffer,
                            name
                        }
                    }, e.origin, [buffer]);
                })
                .catch(err => {
                    log.error(err);
                    e.source.postMessage({
                        p4: {
                            type: 'cancel-import'
                        }
                    }, e.origin);
                });
        }
        render() {
            const {
                /* eslint-disable no-unused-vars */
                canOpenPackager,
                /* eslint-enable no-unused-vars */
                ...props
            } = this.props;
            return (
                <WrappedComponent
                    onClickPackager={this.handleClickPackager}
                    {...props}
                />
            );
        }
    }
    PackagerIntegrationComponent.propTypes = {
        canOpenPackager: PropTypes.bool,
        reduxProjectTitle: PropTypes.string,
        vm: PropTypes.shape({
            runtime: PropTypes.shape({
                dimodServer: PropTypes.shape({})
            }),
            saveProjectSb3: PropTypes.func
        })
    };
    const mapStateToProps = state => ({
        canOpenPackager: getIsShowingProject(state.scratchGui.projectState.loadingState),
        reduxProjectTitle: state.scratchGui.projectTitle,
        vm: state.scratchGui.vm
    });
    const mapDispatchToProps = () => ({});
    return connect(
        mapStateToProps,
        mapDispatchToProps
    )(PackagerIntegrationComponent);
};

export {
    PackagerIntegrationHOC as default
};
