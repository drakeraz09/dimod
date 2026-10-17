import {loadSeeInside} from "./dimod-project.js";
import React from "react";
import PropTypes from "prop-types";
import { intlShape, injectIntl } from "react-intl";
import bindAll from "lodash.bindall";
import { connect } from "react-redux";
import JSZip from "jszip";
import { protobufToJson } from "pmp-protobuf";

import { setProjectUnchanged } from "../reducers/project-changed";
import {
    LoadingStates,
    getIsCreatingNew,
    getIsFetchingWithId,
    getIsLoading,
    getIsShowingProject,
    onFetchedProjectData,
    projectError,
    requestProjectResync,
    setProjectId
} from "../reducers/project-state";
import { activateTab, BLOCKS_TAB_INDEX } from "../reducers/editor-tab";

import log from "./log";
import storage from "./storage";
import {dimodDecryptProject, projectCache, readZipManifest} from "./dimod-project";

let loadSeq = 0;
const SAME_ORIGIN_API = "/api";
const SOURCE_FETCH_ATTEMPTS = 4;

import { MISSING_PROJECT_ID } from "./tw-missing-project";
import VM from "scratch-vm";
import * as progressMonitor from "../components/loader/tw-progress-monitor";
import { testSeat as testWindowSeat, requestEditorProject } from "./dimod-server";

/* Higher Order Component to provide behavior for loading projects by id. If
 * there's no id, the default project is loaded.
 * @param {React.Component} WrappedComponent component to receive projectData prop
 * @returns {React.Component} component with project loading behavior
 */
const ProjectFetcherHOC = function (WrappedComponent) {
    class ProjectFetcherComponent extends React.Component {
        constructor(props) {
            super(props);
            bindAll(this, ["fetchProject", "handleResyncRequested"]);
            storage.setProjectHost(props.projectHost);
            storage.setProjectToken(props.projectToken);
            storage.setAssetHost(props.assetHost);
            storage.setTranslatorFunction(props.intl.formatMessage);
            // props.projectId might be unset, in which case we use our default;
            // or it may be set by an even higher HOC, and passed to us.
            // Either way, we now know what the initial projectId should be, so
            // set it in the redux store.
            if (
                props.projectId !== "" &&
                props.projectId !== null &&
                typeof props.projectId !== "undefined"
            ) {
                this.props.setProjectId(props.projectId.toString());
            }
        }
        componentDidMount() {
            window.addEventListener("dimod:project-resync-needed", this.handleResyncRequested);
        }
        componentDidUpdate(prevProps) {
            if (prevProps.projectHost !== this.props.projectHost) {
                storage.setProjectHost(this.props.projectHost);
            }
            if (prevProps.projectToken !== this.props.projectToken) {
                storage.setProjectToken(this.props.projectToken);
            }
            if (prevProps.assetHost !== this.props.assetHost) {
                storage.setAssetHost(this.props.assetHost);
            }
            if (this.props.isFetchingWithId && !prevProps.isFetchingWithId) {
                this.fetchProject(
                    this.props.reduxProjectId,
                    this.props.loadingState,
                );
            }
            if (this.props.isShowingProject && !prevProps.isShowingProject) {
                this.props.onProjectUnchanged();
            }
            if (
                this.props.isShowingProject &&
                (prevProps.isLoadingProject || prevProps.isCreatingNew)
            ) {
                this.props.onActivateTab(BLOCKS_TAB_INDEX);
            }
        }
        componentWillUnmount() {
            window.removeEventListener("dimod:project-resync-needed", this.handleResyncRequested);
        }
        handleResyncRequested() {
            this.props.onRequestProjectResync();
        }

        async fetchProject(projectId, loadingState) {
            // tw: clear and stop the VM before fetching
            // these will also happen later after the project is fetched, but fetching may take a while and
            // the project shouldn't be running while fetching the new project
            try {
                this.props.vm.stop();
            } catch (e) {
                log.warn('stopping before a project load failed', e);
            }
            try {
                this.props.vm.clear();
            } catch (e) {
                log.warn('clearing before a project load failed', e);
            }
            try {
                this.props.vm.stop();
            } catch (e) {
                log.warn('stopping before a project load failed', e);
            }

            // pm: clear url params when fetching if the project ID is 'default'
            if (
                loadingState === "FETCHING_NEW_DEFAULT" &&
                (projectId == 0 || projectId === null)
            ) {
                this.props.vm.setFramerate(30);
                this.props.vm.setRuntimeOptions({
                    disableDirectionClamping: false,
                    dangerousOptimizations: false,
                    disableOffscreenRendering: false,
                    fencing: true,
                    maxClones: 300,
                    miscLimits: true,
                });
            }
            let assetPromise;
            // In case running in node...
            const params = typeof URLSearchParams === "undefined" ? null : new URLSearchParams(location.search);
            const dimodId = params && params.get("dimod_id");
            let projectUrl;
            let sameOriginUrl = null;
            let sameOriginAuth = false;
            if (dimodId) {
                if (!process.env.DIMOD_WARP_ASSET_BASE) {
                    const configError = new Error(
                        "DIMOD_WARP_ASSET_BASE is not configured in this build... warp games can't be played."
                    );
                    this.props.onError(configError);
                    log.error(configError);
                    return;
                }
                projectUrl = `${process.env.DIMOD_WARP_ASSET_BASE}/${dimodId}.dat`;
                sameOriginUrl = `${SAME_ORIGIN_API}/warp-assets/${encodeURIComponent(dimodId)}.dat`;
            } else {
                projectUrl = params && params.get("project_url");
            }
            const viewId = !dimodId && params && !params.get("p") ? params.get("view") : null;
            if (viewId) {
                const info = await loadSeeInside();
                if (!info || info.error) {
                    const viewError = new Error(`Couldn't open this game: ${(info && info.error) || "the server couldn't be reached"}.`);
                    this.props.onError(viewError);
                    log.error(viewError);
                    return;
                }
                projectUrl = `${process.env.DIMOD_WARP_ASSET_BASE}/${info.short_id}.dat`;
                sameOriginUrl = `${SAME_ORIGIN_API}/warp-assets/${encodeURIComponent(info.short_id)}.dat`;
            }
            const historyRef = !dimodId && !viewId && params && !params.get("p") ? params.get("history") : null;
            if (historyRef && !projectUrl) {
                const [historyProject, historySave] = historyRef.split(":");
                let access = null;
                try {
                    const token = localStorage.getItem("token");
                    const res = await fetch(
                        `${process.env.DIMOD_API_BASE}/projects/${encodeURIComponent(historyProject)}` +
                            `/source/history/${encodeURIComponent(historySave || "")}/access`,
                        {headers: token ? {Authorization: `Bearer ${token}`} : {}, cache: "no-store"},
                    );
                    access = res.ok ? await res.json() : null;
                } catch (e) {
                    access = null;
                }
                if (!access || !access.url) {
                    const historyError = new Error("Couldn't open that save: it may have been deleted, or you're not logged in.");
                    this.props.onError(historyError);
                    log.error(historyError);
                    return;
                }
                projectUrl = access.url;
                sameOriginUrl = `${SAME_ORIGIN_API}/projects/${encodeURIComponent(historyProject)}` +
                    `/source/history/${encodeURIComponent(historySave || "")}/file`;
                sameOriginAuth = true;
            }
            const isDimodEncrypted = Boolean(dimodId) || Boolean(viewId) || (params && params.get("dimod_encrypted") === "1");

            const dimodProjectId = params && params.get("p");
            const testSeat = testWindowSeat();
            let editorProject = null;
            if (testSeat) editorProject = requestEditorProject(testSeat).then((buffer) => ({data: buffer}));
            let sourceRevision = null;
            let cachedSource = null;
            if (!projectUrl && dimodProjectId && !testSeat) {
                let data = null;
                let failure = null;
                for (let attempt = 0; attempt < SOURCE_FETCH_ATTEMPTS; attempt++) {
                    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
                    try {
                        const token = localStorage.getItem("token");
                        const res = await fetch(
                            `${process.env.DIMOD_API_BASE}/projects/${dimodProjectId}/source`,
                            {headers: token ? {Authorization: `Bearer ${token}`} : {}, cache: "no-store"},
                        );
                        if (res.ok) {
                            data = await res.json();
                            failure = null;
                            break;
                        }
                        if (res.status === 404) {
                            failure = null;
                            break;
                        }
                        const body = await res.json().catch(() => null);
                        failure = {status: res.status, message: body && body.error};
                        if (res.status === 401 || res.status === 403) break;
                    } catch (e) {
                        failure = {status: 0, message: e && e.message};
                    }
                }
                if (failure) {
                    const why = failure.status === 401 ? "you're not logged in (or your login expired). Log in and reload." :
                        failure.status === 403 ? "you don't have access to it." :
                        failure.status === 0 ? "the server couldn't be reached. Reload to try again." :
                        `the server returned ${failure.status}${failure.message ? ` (${failure.message})` : ""}. Reload to try again.`;
                    const loadError = new Error(`Couldn't open project ${dimodProjectId}: ${why} Your project was not changed.`);
                    this.props.onError(loadError);
                    log.error(loadError);
                    return;
                }
                if (data) {
                    projectUrl = data.url;
                    sameOriginUrl = `${SAME_ORIGIN_API}/projects/${encodeURIComponent(dimodProjectId)}/source/file`;
                    sameOriginAuth = true;
                    if (Number.isInteger(data.revision)) {
                        sourceRevision = data.revision;
                        try {
                            cachedSource = await projectCache.load(dimodProjectId, sourceRevision);
                        } catch (e) {
                        }
                    }
                }
            }

            const rememberSource = manifest => {
                if (sourceRevision === null || !manifest) return;
                window.dimodLoadedSource = {projectId: dimodProjectId, revision: sourceRevision, manifest, seq: ++loadSeq};
            };

            if (editorProject) {
                assetPromise = editorProject;
            } else if (cachedSource) {
                rememberSource(cachedSource.manifest);
                progressMonitor.beginAssetLoading(this.props.vm, cachedSource.manifest);
                assetPromise = Promise.resolve({data: cachedSource.buffer});
            } else if (projectUrl) {
                if (
                    !projectUrl.startsWith("http:") &&
                    !projectUrl.startsWith("https:")
                ) {
                    projectUrl = `https://${projectUrl}`;
                }

                const projectHost = (() => {
                    try {
                        return new URL(projectUrl).host;
                    } catch (e) {
                        return "the project server";
                    }
                })();
                const download = (url, host, options) => progressMonitor
                    .fetchWithProgress(url, options)
                    .catch(() => {
                        throw new Error(
                            `Couldn't download the project from ${host} (network error or blocked by CORS)`,
                        );
                    })
                    .then(async (r) => {
                        if (!r.ok) {
                            const reason = await r.text().catch(() => "");
                            throw new Error(
                                `Request to ${host} returned status ${r.status}` +
                                    (reason ? `: ${reason.slice(0, 200)}` : ""),
                            );
                        }
                        return r.arrayBuffer();
                    });
                const downloaded = sameOriginUrl ?
                    download(projectUrl, projectHost, {attempts: 1}).catch((directError) => {
                        log.warn("direct project download failed, using this site instead", directError);
                        const token = sameOriginAuth ? localStorage.getItem("token") : null;
                        return download(sameOriginUrl, location.host, {
                            headers: token ? {Authorization: `Bearer ${token}`} : null,
                        }).catch((fallbackError) => {
                            throw new Error(`${fallbackError.message}. Before that: ${directError.message}`);
                        });
                    }) :
                    download(projectUrl, projectHost);
                assetPromise = downloaded
                    .then((buffer) => {
                        if (
                            this.props.vm.runtime.renderer?.setPrivateSkinAccess
                        )
                            this.props.vm.runtime.renderer.setPrivateSkinAccess(
                                false,
                            );
                        return buffer;
                    })
                    .then((buffer) => {
                        if (isDimodEncrypted) {
                            const data = dimodDecryptProject(buffer);
                            progressMonitor.beginAssetLoading(this.props.vm, readZipManifest(data));
                            return {data};
                        }
                        const manifest = readZipManifest(buffer);
                        progressMonitor.beginAssetLoading(this.props.vm, manifest);
                        if (sourceRevision !== null) {
                            rememberSource(manifest);
                            if (manifest) {
                                const copy = buffer.slice(0);
                                setTimeout(() => projectCache.storeZip(dimodProjectId, sourceRevision, copy, manifest), 5000);
                            }
                        }
                        return {data: buffer};
                    });
            } else {
                // patch for default project
                if (projectId === "0") {
                    storage.setProjectToken(projectId);
                    assetPromise = fetch(`${process.env.DIMOD_API_BASE}/blank-project`, {cache: "no-store"})
                        .then((r) => (r.ok ? r.arrayBuffer() : null))
                        .catch(() => null)
                        .then((buffer) => (buffer ? {data: buffer} : storage.load(
                            storage.AssetType.Project,
                            projectId,
                            storage.DataFormat.JSON,
                        )));
                } else {
                    assetPromise = storage.load(
                        storage.AssetType.Project,
                        projectId,
                        storage.DataFormat.JSON,
                    );
                    storage.setProjectID(projectId);
                }
            }

            return assetPromise
                .then((projectAsset) => {
                    console.log(`project asset: ${projectAsset}`);

                    // pm: If the project data is missing, it *probably* doesn't exist
                    // (barring some bad internet connection, which I don't feel like accounting for),
                    // and the "missing project" project should be loaded instead.
                    // TODO: have the server send an explicit "this doesn't exist"
                    if (!projectAsset) {
                        return storage.load(
                            storage.AssetType.Project,
                            MISSING_PROJECT_ID,
                            storage.DataFormat.JSON,
                        );
                    }
                    return projectAsset;
                })
                .then((projectAsset) => {
                    if (projectAsset) {
                        this.props.onFetchedProjectData(
                            projectAsset.data,
                            loadingState,
                        );
                    } else {
                        throw new Error("Failed to load project.");
                    }
                })
                .catch((err) => {
                    this.props.onError(err);
                    log.error(err);
                });
        }
        render() {
            const {
                /* eslint-disable no-unused-vars */
                assetHost,
                intl,
                isLoadingProject: isLoadingProjectProp,
                loadingState,
                onActivateTab,
                onError: onErrorProp,
                onFetchedProjectData: onFetchedProjectDataProp,
                onProjectUnchanged,
                onRequestProjectResync,
                projectHost,
                projectId,
                reduxProjectId,
                setProjectId: setProjectIdProp,
                /* eslint-enable no-unused-vars */
                isFetchingWithId: isFetchingWithIdProp,
                ...componentProps
            } = this.props;
            return (
                <WrappedComponent
                    fetchingProject={isFetchingWithIdProp}
                    {...componentProps}
                />
            );
        }
    }
    ProjectFetcherComponent.propTypes = {
        assetHost: PropTypes.string,
        canSave: PropTypes.bool,
        intl: intlShape.isRequired,
        isCreatingNew: PropTypes.bool,
        isFetchingWithId: PropTypes.bool,
        isLoadingProject: PropTypes.bool,
        isShowingProject: PropTypes.bool,
        loadingState: PropTypes.oneOf(LoadingStates),
        onActivateTab: PropTypes.func,
        onError: PropTypes.func,
        onFetchedProjectData: PropTypes.func,
        onProjectUnchanged: PropTypes.func,
        onRequestProjectResync: PropTypes.func,
        projectHost: PropTypes.string,
        projectToken: PropTypes.string,
        projectId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
        reduxProjectId: PropTypes.oneOfType([
            PropTypes.string,
            PropTypes.number,
        ]),
        setProjectId: PropTypes.func,
        vm: PropTypes.instanceOf(VM),
    };
    ProjectFetcherComponent.defaultProps = {
        assetHost:
            "https://asset-cdn.penguinmod.com/file/penguinmod-warm-tier-s2-cf",
        projectHost:
            "https://projects.penguinmod.com/api/v1/projects/getProject?requestType=protobuf&projectID",
    };

    const mapStateToProps = (state) => ({
        isCreatingNew: getIsCreatingNew(
            state.scratchGui.projectState.loadingState,
        ),
        isFetchingWithId: getIsFetchingWithId(
            state.scratchGui.projectState.loadingState,
        ),
        isLoadingProject: getIsLoading(
            state.scratchGui.projectState.loadingState,
        ),
        isShowingProject: getIsShowingProject(
            state.scratchGui.projectState.loadingState,
        ),
        loadingState: state.scratchGui.projectState.loadingState,
        reduxProjectId: state.scratchGui.projectState.projectId,
        vm: state.scratchGui.vm,
    });
    const mapDispatchToProps = (dispatch) => ({
        onActivateTab: (tab) => dispatch(activateTab(tab)),
        onError: (error) => dispatch(projectError(error)),
        onFetchedProjectData: (projectData, loadingState) => {
            dispatch(onFetchedProjectData(projectData, loadingState));
        },
        setProjectId: (projectId) => dispatch(setProjectId(projectId)),
        onProjectUnchanged: () => dispatch(setProjectUnchanged()),
        onRequestProjectResync: () => dispatch(requestProjectResync()),
    });
    // Allow incoming props to override redux-provided props. Used to mock in tests.
    const mergeProps = (stateProps, dispatchProps, ownProps) =>
        Object.assign({}, stateProps, dispatchProps, ownProps);
    return injectIntl(
        connect(
            mapStateToProps,
            mapDispatchToProps,
            mergeProps,
        )(ProjectFetcherComponent),
    );
};

export { ProjectFetcherHOC as default };
