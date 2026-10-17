import WavEncoder from 'wav-encoder';

export const SOUND_BYTE_LIMIT = 10 * 1000 * 1000; // 10mb

const _computeRMS = function (samples, start, end, scaling = 0.55) {
    const length = end - start;
    if (length === 0) return 0;
    // Calculate RMS, adapted from https://github.com/Tonejs/Tone.js/blob/master/Tone/component/Meter.js#L88
    let sum = 0;
    for (let i = start; i < end; i++) {
        const sample = samples[i];
        sum += sample ** 2;
    }
    const rms = Math.sqrt(sum / length);
    const val = rms / scaling;
    return Math.sqrt(val);
};

const computeRMS = (samples, scaling) => _computeRMS(samples, 0, samples.length, scaling);

const computeChunkedRMS = function (samples, chunkSize = 1024) {
    const sampleCount = samples.length;
    const chunkLevels = [];
    for (let i = 0; i < sampleCount; i += chunkSize) {
        const maxIndex = Math.min(sampleCount, i + chunkSize);
        chunkLevels.push(_computeRMS(samples, i, maxIndex));
    }
    return chunkLevels;
};

const MAX_EDIT_CHANNELS = 2;

const getBufferChannels = audioBuffer => {
    if (!audioBuffer) return [new Float32Array(1)];
    const channels = [];
    const count = Math.max(1, Math.min(MAX_EDIT_CHANNELS, audioBuffer.numberOfChannels || 1));
    for (let i = 0; i < count; i++) {
        channels.push(audioBuffer.getChannelData(i));
    }
    return channels;
};

const matchChannelCount = (channels, count) => {
    const result = [];
    for (let i = 0; i < count; i++) {
        result.push(channels[Math.min(i, channels.length - 1)]);
    }
    return result;
};

const concatChannels = parts => {
    const count = Math.max(1, ...parts.map(part => part.length));
    const matched = parts.map(part => matchChannelCount(part, count));
    const length = matched.reduce((sum, part) => sum + part[0].length, 0);
    const result = [];
    for (let c = 0; c < count; c++) {
        const samples = new Float32Array(Math.max(1, length));
        let offset = 0;
        for (const part of matched) {
            samples.set(part[c], offset);
            offset += part[c].length;
        }
        result.push(samples);
    }
    return result;
};

const encodeAndAddSoundToVM = function (vm, samples, sampleRate, name, callback) {
    const channelData = Array.isArray(samples) ? samples : [samples];
    WavEncoder.encode({
        sampleRate: sampleRate,
        channelData: channelData
    }).then(wavBuffer => {
        const vmSound = {
            format: '',
            dataFormat: 'wav',
            rate: sampleRate,
            sampleCount: channelData[0].length
        };

        // Create an asset from the encoded .wav and get resulting md5
        const storage = vm.runtime.storage;
        vmSound.asset = storage.createAsset(
            storage.AssetType.Sound,
            storage.DataFormat.WAV,
            new Uint8Array(wavBuffer),
            null,
            true // generate md5
        );
        vmSound.assetId = vmSound.asset.assetId;

        // update vmSound object with md5 property
        vmSound.md5 = `${vmSound.assetId}.${vmSound.dataFormat}`;
        // The VM will update the sound name to a fresh name
        vmSound.name = name;

        vm.addSound(vmSound).then(() => {
            if (callback) callback();
        });
    });
};


/**
 * Downsample the given buffer to try to reduce file size below SOUND_BYTE_LIMIT
 * @param {SoundBuffer} buffer - Buffer to resample
 * @param {function(SoundBuffer):Promise<SoundBuffer>} resampler - resampler function
 * @returns {SoundBuffer} Downsampled buffer with half the sample rate
 */
const downsampleIfNeeded = (buffer, resampler) => {
    const {channels, sampleRate} = buffer;
    const encodedByteLength = channels.length * channels[0].length * 2; /* bitDepth 16 bit */
    // Resolve immediately if already within byte limit
    if (encodedByteLength < SOUND_BYTE_LIMIT || sampleRate <= 22050) {
        return Promise.resolve({channels, sampleRate});
    }
    // TW: Don't check if the sound will still fit at this reduced sample rate.
    // Instead the GUI will show a warning if it's too large.
    return resampler({channels, sampleRate}, 22050);
};

/**
 * Drop every other sample of an audio buffer as a last-resort way of downsampling.
 * @param {SoundBuffer} buffer - Buffer to resample
 * @returns {SoundBuffer} Downsampled buffer with half the sample rate
 */
const dropEveryOtherSample = buffer => {
    const newLength = Math.floor(buffer.channels[0].length / 2);
    const newChannels = buffer.channels.map(samples => {
        const newSamples = new Float32Array(newLength);
        for (let i = 0; i < newLength; i++) {
            newSamples[i] = samples[i * 2];
        }
        return newSamples;
    });
    return {
        channels: newChannels,
        sampleRate: buffer.sampleRate / 2
    };
};

export {
    computeRMS,
    computeChunkedRMS,
    getBufferChannels,
    matchChannelCount,
    concatChannels,
    encodeAndAddSoundToVM,
    downsampleIfNeeded,
    dropEveryOtherSample
};
