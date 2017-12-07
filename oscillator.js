class Oscillator {

    constructor(context) {
        this.context = context;
    }

    init() {
        this.oscillator = this.context.createOscillator();
        this.gainNode = this.context.createGain();
        this.oscillator.connect(this.gainNode);
        this.gainNode.connect(this.context.destination);
    }

    play(value) {
        this.init();
        this.oscillator.frequency.value = value;
        this.gainNode.gain.setValueAtTime(0.001, this.context.currentTime);
        this.oscillator.start();
        this.gainNode.gain.exponentialRampToValueAtTime(0.7, this.context.currentTime + 0.01); // Fade to value 0.7 in 10ms
    }

    stop() {
        this.gainNode.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + 0.01); // Fade to value 0.001 in 10ms
        this.oscillator.stop(this.context.currentTime + 0.01);
    }
}

module.exports = Oscillator;
