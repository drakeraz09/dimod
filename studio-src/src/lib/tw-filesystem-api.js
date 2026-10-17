import { isApiAvailable, isTypeFilterAvailable } from './pm-mature-fs-available';

const available = isApiAvailable;

// pm: Some bad mobile devices block any file type (iOS), so these funcs should allow all files on mobile
const showSaveFilePicker = fileName => window.showSaveFilePicker({
    suggestedName: fileName,
    ...(!isTypeFilterAvailable() ? {} : {
        types: [
            {
                description: 'Dimod Warp Project',
                accept: {
                    'application/x.scratch.sb3': '.warp'
                }
            }
        ],
        excludeAcceptAllOption: true
    }),
});

const showOpenFilePicker = async () => {
    const [handle] = await window.showOpenFilePicker({
        multiple: false,
        ...(!isTypeFilterAvailable() ? {} : {
            types: [
                {
                    description: 'Supported Files',
                    accept: {
                        'application/x.scratch.sb3': ['.warp', '.pmp', '.pm', '.sb3', '.sb2', '.sb']
                    }
                },
                {
                    description: 'Dimod Warp Project',
                    accept: {
                        'application/x.scratch.sb3': ['.warp']
                    }
                },
                {
                    description: 'PenguinMod Project',
                    accept: {
                        'application/x.scratch.sb3': ['.pmp', '.pm']
                    }
                },
                {
                    description: 'Scratch Project',
                    accept: {
                        'application/x.scratch.sb3': ['.sb3', '.sb2', '.sb']
                    }
                }
            ]
        }),
    });
    return handle;
};

const showDirectoryPicker = async (optId, optStartIn) => {
    const handle = await window.showDirectoryPicker({
        id: optId || "pm-directory-picker",
        mode: "readwrite",
        startIn: optStartIn || "documents",
    });
    return handle;
};

export default {
    available,
    showOpenFilePicker,
    showSaveFilePicker,
    showDirectoryPicker
};
