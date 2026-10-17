import SharedAudioContext from './shared-audio-context.js';

class AudioBufferPlayer {
    constructor (samples, sampleRate) {
        const channels = Array.isArray(samples) ? samples : [samples];
        this.audioContext = new SharedAudioContext();
        this.buffer = this.audioContext.createBuffer(channels.length, channels[0].length, sampleRate);
        channels.forEach((channel, i) => this.buffer.getChannelData(i).set(channel));
        this.source = null;

        this.startTime = null;
        this.updateCallback = null;
        this.trimStart = null;
        this.trimEnd = null;
    }

    play (trimStart, trimEnd, onUpdate, onEnded) {
        this.updateCallback = onUpdate;
        this.trimStart = trimStart;
        this.trimEnd = trimEnd;
        const token = this.token = (this.token || 0) + 1;

        const trimStartTime = this.buffer.duration * trimStart;
        const trimmedDuration = (this.buffer.duration * trimEnd) - trimStartTime;

        const source = this.source = this.audioContext.createBufferSource();
        source.onended = onEnded;
        source.buffer = this.buffer;
        source.connect(this.audioContext.destination);

        const begin = () => {
            if (token !== this.token) return;
            this.startTime = this.audioContext.currentTime + 0.02;
            source.start(this.startTime, trimStartTime, trimmedDuration);
            this.update(token);
        };
        if (this.audioContext.state === 'running') begin();
        else this.audioContext.resume().then(begin, begin);
    }

    update (token) {
        if (token !== this.token) return;
        const elapsed = Math.max(0, this.audioContext.currentTime - this.startTime);
        const percentage = elapsed / this.buffer.duration;
        if (percentage + this.trimStart < this.trimEnd && this.source.onended) {
            requestAnimationFrame(() => this.update(token));
            this.updateCallback(percentage + this.trimStart);
        } else {
            this.updateCallback = null;
        }
    }

    stop () {
        this.token = (this.token || 0) + 1;
        if (this.source) {
            this.source.onended = null; // Do not call onEnded callback if manually stopped
            try {
                this.source.stop();
            } catch (e) {
                // This is probably Safari, which dies when you call stop more than once
                // which the spec says is allowed: https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode
                console.log('Caught error while stopping buffer source node.'); // eslint-disable-line no-console
            }
        }
    }
}

export default AudioBufferPlayer;
