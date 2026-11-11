import { Midi } from '@tonejs/midi'
import type { NoteEvent, ParsedMidi, TrackInfo } from '../types'

const MIDDLE_C = 60

/**
 * Multi-track files: tracks whose average pitch sits in the lower half are the left hand.
 * Single-track files (or tracks with the same range): split at middle C.
 */
function assignHands(notes: NoteEvent[], trackCount: number) {
  const sum = new Array<number>(trackCount).fill(0)
  const count = new Array<number>(trackCount).fill(0)
  for (const n of notes) {
    sum[n.track] += n.midi
    count[n.track]++
  }
  const means = sum.map((s, i) => s / count[i])
  const lowest = Math.min(...means)
  const highest = Math.max(...means)

  if (trackCount < 2 || highest - lowest < 3) {
    for (const n of notes) n.hand = n.midi < MIDDLE_C ? 0 : 1
    return
  }
  const threshold = (lowest + highest) / 2
  for (const n of notes) n.hand = means[n.track] < threshold ? 0 : 1
}

export async function parseMidiFile(file: File): Promise<ParsedMidi> {
  const midi = new Midi(await file.arrayBuffer())
  const tracks: TrackInfo[] = []
  const notes: NoteEvent[] = []

  for (const track of midi.tracks) {
    if (track.notes.length === 0 || track.instrument.percussion) continue
    const index = tracks.length
    tracks.push({
      index,
      name: track.name || `Track ${index + 1}`,
      instrument: track.instrument.name,
      noteCount: track.notes.length,
    })
    for (const n of track.notes) {
      notes.push({
        midi: n.midi,
        time: n.time,
        duration: Math.max(n.duration, 0.03),
        velocity: n.velocity,
        track: index,
        hand: 1,
      })
    }
  }

  assignHands(notes, tracks.length)

  notes.sort((a, b) => a.time - b.time || a.midi - b.midi)

  const lastNoteEnd = notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0)

  return {
    name: midi.name || file.name,
    duration: Math.max(midi.duration, lastNoteEnd),
    bpm: midi.header.tempos[0]?.bpm ?? 120,
    tracks,
    notes,
  }
}
