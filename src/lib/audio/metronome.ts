import * as Tone from 'tone';

// Clicks every beat of Tone's transport, accenting the first beat of each bar.
// Schedule it after transport.cancel() (which removes it) and before transport.start().
export class Metronome {
  enabled = true;  // mute without rescheduling
  beatsPerBar = 4;
  // Called on every beat (even when muted), at the moment it's heard, for UI.
  // `beat` counts from 0 at transport position 0.
  onBeat: ((beat: number) => void) | null = null;

  private synth = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 }
  }).toDestination();
  private eventId: number | null = null;

  schedule() {
    this.unschedule();
    const transport = Tone.getTransport();
    this.eventId = transport.scheduleRepeat(
      (time) => {
        const beat = Math.round(transport.getTicksAtTime(time) / transport.PPQ);
        const accent = beat % this.beatsPerBar === 0;
        if (this.enabled) {
          this.synth.triggerAttackRelease(accent ? 1760 : 1320, 0.03, time, accent ? 0.8 : 0.45);
        }
        Tone.getDraw().schedule(() => this.onBeat?.(beat), time);
      },
      '4n',
      0
    );
  }

  unschedule() {
    if (this.eventId !== null) Tone.getTransport().clear(this.eventId);
    this.eventId = null;
  }

  dispose() {
    this.unschedule();
    this.synth.dispose();
  }
}
