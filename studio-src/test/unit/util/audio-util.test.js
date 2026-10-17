import {
    computeRMS,
    computeChunkedRMS,
    downsampleIfNeeded,
    dropEveryOtherSample,
    concatChannels
} from '../../../src/lib/audio/audio-util';

describe('computeRMS', () => {
    test('returns 0 when given no samples', () => {
        expect(computeRMS([])).toEqual(0);
    });
    test('returns the RMS scaled by the given unity value and square rooted', () => {
        const unity = 0.5;
        const samples = [3, 2, 1];
        expect(computeRMS(samples, unity)).toEqual(
            Math.sqrt(Math.sqrt(((3 * 3) + (2 * 2) + (1 * 1)) / 3) / 0.5)
        );
    });
    test('uses a default unity value of 0.55', () => {
        const samples = [1, 1, 1];
        // raw rms is 1, scaled to (1 / 0.55) and square rooted
        expect(computeRMS(samples)).toEqual(Math.sqrt(1 / 0.55));
    });
});


describe('computeChunkedRMS', () => {
    test('computes the rms for each chunk based on chunk size', () => {
        const samples = [2, 1, 3, 2, 5];
        const chunkedLevels = computeChunkedRMS(samples, 2);
        // chunked to [2, 0], [3, 0], [5]
        // rms scaled with default unity of 0.55
        expect(chunkedLevels.length).toEqual(3);
        expect(chunkedLevels).toEqual([
            Math.sqrt(Math.sqrt(((2 * 2) + (1 * 1)) / 2) / 0.55),
            Math.sqrt(Math.sqrt(((3 * 3) + (2 * 2)) / 2) / 0.55),
            Math.sqrt(Math.sqrt((5 * 5) / 1) / 0.55)
        ]);
    });
    test('chunk size larger than sample size creates single chunk', () => {
        const samples = [1, 1, 1];
        const chunkedLevels = computeChunkedRMS(samples, 7);
        // chunked to [1, 1, 1]
        // rms scaled with default unity of 0.55
        expect(chunkedLevels.length).toEqual(1);
        expect(chunkedLevels).toEqual([Math.sqrt(1 / 0.55)]);
    });
    test('chunk size as multiple is handled correctly', () => {
        const samples = [1, 1, 1, 1, 1, 1];
        const chunkedLevels = computeChunkedRMS(samples, 3);
        // chunked to [1, 1, 1], [1, 1, 1]
        // rms scaled with default unity of 0.55
        expect(chunkedLevels.length).toEqual(2);
        expect(chunkedLevels).toEqual([Math.sqrt(1 / 0.55), Math.sqrt(1 / 0.55)]);
    });
});

describe('downsampleIfNeeded', () => {
    const samples = {length: 1};
    const channels = [samples];
    const sampleRate = 44100;
    test('returns given data when no downsampling needed', async () => {
        samples.length = 1;
        const res = await downsampleIfNeeded({channels, sampleRate}, null);
        expect(res.channels).toEqual(channels);
        expect(res.sampleRate).toEqual(sampleRate);
    });
    test('downsamples to 22050 if that puts it under the limit', async () => {
        samples.length = 44100 * 3 * 60;
        const resampler = jest.fn(() => 'TEST');
        const res = await downsampleIfNeeded({channels, sampleRate}, resampler);
        expect(resampler).toHaveBeenCalledWith({channels, sampleRate}, 22050);
        expect(res).toEqual('TEST');
    });
    test('counts every channel towards the limit', async () => {
        samples.length = 44100 * 1.5 * 60;
        const resampler = jest.fn(() => 'TEST');
        await downsampleIfNeeded({channels, sampleRate}, resampler);
        expect(resampler).not.toHaveBeenCalled();
        await downsampleIfNeeded({channels: [samples, samples], sampleRate}, resampler);
        expect(resampler).toHaveBeenCalled();
    });
    test('does not resample a sound that is already at 22050', async () => {
        samples.length = 44100 * 3 * 60;
        const resampler = jest.fn(() => 'TEST');
        const res = await downsampleIfNeeded({channels, sampleRate: 22050}, resampler);
        expect(resampler).not.toHaveBeenCalled();
        expect(res.sampleRate).toEqual(22050);
    });
});

describe('dropEveryOtherSample', () => {
    const buffer = {
        channels: [[1, 0, 2, 0, 3, 0], [4, 0, 5, 0, 6, 0]],
        sampleRate: 2
    };
    test('result is half the length', () => {
        const {channels} = dropEveryOtherSample(buffer);
        expect(channels[0].length).toEqual(Math.floor(buffer.channels[0].length / 2));
    });
    test('result contains only even-index items of each channel', () => {
        const {channels} = dropEveryOtherSample(buffer);
        expect(channels).toEqual([new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])]);
    });
    test('result sampleRate is given sampleRate / 2', () => {
        const {sampleRate} = dropEveryOtherSample(buffer);
        expect(sampleRate).toEqual(buffer.sampleRate / 2);
    });
});

describe('concatChannels', () => {
    test('joins pieces channel by channel', () => {
        const res = concatChannels([
            [new Float32Array([1, 2]), new Float32Array([5, 6])],
            [new Float32Array([3]), new Float32Array([7])]
        ]);
        expect(res).toEqual([new Float32Array([1, 2, 3]), new Float32Array([5, 6, 7])]);
    });
    test('a mono piece joined to a stereo one goes to both channels', () => {
        const res = concatChannels([
            [new Float32Array([1, 2])],
            [new Float32Array([3]), new Float32Array([7])]
        ]);
        expect(res).toEqual([new Float32Array([1, 2, 3]), new Float32Array([1, 2, 7])]);
    });
    test('never returns an empty sound', () => {
        const res = concatChannels([[new Float32Array(0), new Float32Array(0)]]);
        expect(res).toEqual([new Float32Array(1), new Float32Array(1)]);
    });
});
