// Recorded drum sounds, free for any use (commercial too) with the credit shown
// (DRUM_SAMPLES_CREDIT; the drum sound browser shows it). Downloaded when first used.
//
// - AVL Drumkits by Glen MacArthur (CC-BY-SA 3.0): two acoustic rock kits, "Black Pearl"
//   and "Red Zeppelin" (https://github.com/studiorack/avl-drumkits). We use one velocity
//   layer of each sound.
// - TR-808 recordings by Michael Fischer (no restrictions), packaged as @fluid-music/tr-808.
// - Versilian Community Sample Library (CC0) percussion (https://github.com/sgossner/VCSL).
//
// A drum row's `sound` is either a synthesized sound's type ('kick'…, DRUM_SOUNDS in
// drums.ts), one of these ids ('s:pearl:kick'…), or a sound you uploaded ('u:<id>').

export const DRUM_SAMPLES_CREDIT =
  'Drum samples: AVL Drumkits by Glen MacArthur (CC-BY-SA 3.0), TR-808 by Michael Fischer, Versilian Community Sample Library (CC0).';

const AVL = 'https://cdn.jsdelivr.net/gh/studiorack/avl-drumkits@main/Samples/';
const TR808 = 'https://cdn.jsdelivr.net/npm/@fluid-music/tr-808@0.0.2/TR808WAV/';
const VCSL = 'https://cdn.jsdelivr.net/gh/sgossner/VCSL@master/';

export interface DrumSample {
  id: string;
  name: string;
  kit: string; // the group it's listed under
  url: string;
}

const avl = (kit: string, key: string, name: string, file: string): DrumSample => ({
  id: `s:${key}:${file}`,
  name,
  kit,
  url: `${AVL}${file}-4.flac` // layer 4 of 5: strong, not the very hardest
});
const tr = (name: string, file: string): DrumSample => ({ id: `s:808:${file}`, name, kit: 'TR-808', url: `${TR808}${file}` });
const vcsl = (name: string, path: string): DrumSample => ({ id: `s:vcsl:${path.split('/').pop()}`, name, kit: 'Percussion', url: encodeURI(`${VCSL}${path}`) });

const PEARL = 'Acoustic kit: Black Pearl';
const LUDWIG = 'Acoustic kit: Red Zeppelin';
const SM = 'Membranophones/Struck Membranophones/';
const SI = 'Idiophones/Struck Idiophones/';

export const DRUM_SAMPLES: DrumSample[] = [
  avl(PEARL, 'pearl', 'Kick', '36-Pearl22Kick'),
  avl(PEARL, 'pearl', 'Snare', '38-PearlSnare'),
  avl(PEARL, 'pearl', 'Snare (bright)', '38-PearlSnare2'),
  avl(PEARL, 'pearl', 'Snare rim', '40-PearlSnareEdge'),
  avl(PEARL, 'pearl', 'Side stick', '37-SideStick'),
  avl(PEARL, 'pearl', 'Hi-hat closed', '42-SabianRockHatClosed'),
  avl(PEARL, 'pearl', 'Hi-hat pedal', '44-SabianRockHatPedal'),
  avl(PEARL, 'pearl', 'Hi-hat half-open', '46-SabianRockHatSemiOpen'),
  avl(PEARL, 'pearl', 'Hi-hat open (swish)', '48-SabianRockHatSwish'),
  avl(PEARL, 'pearl', 'Tom high', '45-Pearl12Tom'),
  avl(PEARL, 'pearl', 'Tom mid', '47-Pearl13Tom2'),
  avl(PEARL, 'pearl', 'Floor tom', '41-Pearl16FloorTom'),
  avl(PEARL, 'pearl', 'Crash', '49-SabianAA16Crash'),
  avl(PEARL, 'pearl', 'Crash 2', '57-SabianAAX17Crash'),
  avl(PEARL, 'pearl', 'Ride', '51-SabianAAX20Ride'),
  avl(PEARL, 'pearl', 'Ride bell', '53-SabianAAX20RideBell'),
  avl(PEARL, 'pearl', 'Splash', '55-ZildjianA10Splash'),
  avl(PEARL, 'pearl', 'Hand clap', '39-HandClap'),
  avl(PEARL, 'pearl', 'Tambourine', '54-Tambourine'),
  avl(PEARL, 'pearl', 'Cowbell', '56-Cowbell'),
  avl(PEARL, 'pearl', 'Maraca', '64-Maraca'),
  avl(LUDWIG, 'ludwig', 'Kick (26")', '36-Ludwig26Kick'),
  avl(LUDWIG, 'ludwig', 'Snare (porkpie)', '38-PorkpieSnare'),
  avl(LUDWIG, 'ludwig', 'Snare rim', '40-PorkpieSnareEdge'),
  avl(LUDWIG, 'ludwig', 'Side stick', '37-Sidestick2'),
  avl(LUDWIG, 'ludwig', 'Tom', '45-Ludwig14Tom'),
  avl(LUDWIG, 'ludwig', 'Floor tom 16"', '41-Ludwig16FloorTom'),
  avl(LUDWIG, 'ludwig', 'Floor tom 18"', '43-Ludwig18FloorTom'),
  avl(LUDWIG, 'ludwig', 'Crash', '49-ZildjianA20Crash'),
  avl(LUDWIG, 'ludwig', 'Crash (K)', '57-ZildjianK17Crash'),
  avl(LUDWIG, 'ludwig', 'Ride', '51-ZildjianA24Ride'),
  avl(LUDWIG, 'ludwig', 'Ride bell', '53-ZildjianA24RideBell'),
  avl(LUDWIG, 'ludwig', 'Roto tom high', '61-RotoTomHi'),
  avl(LUDWIG, 'ludwig', 'Roto tom mid', '62-RotoTomMid'),
  avl(LUDWIG, 'ludwig', 'Roto tom low', '63-RotoTomLo'),
  tr('Kick', 'BD/BD5050.WAV'),
  tr('Kick (long boom)', 'BD/BD2575.WAV'),
  tr('Kick (short click)', 'BD/BD7510.WAV'),
  tr('Snare', 'SD/SD5050.WAV'),
  tr('Snare (snappy)', 'SD/SD2575.WAV'),
  tr('Clap', 'CP/CP.WAV'),
  tr('Rimshot', 'RS/RS.WAV'),
  tr('Hi-hat closed', 'CH/CH.WAV'),
  tr('Hi-hat open', 'OH/OH50.WAV'),
  tr('Cymbal', 'CY/CY5050.WAV'),
  tr('Cowbell', 'CB/CB.WAV'),
  tr('Clave', 'CL/CL.WAV'),
  tr('Maracas', 'MA/MA.WAV'),
  tr('Tom low', 'LT/LT50.WAV'),
  tr('Tom mid', 'MT/MT50.WAV'),
  tr('Tom high', 'HT/HT50.WAV'),
  tr('Conga low', 'LC/LC50.WAV'),
  tr('Conga mid', 'MC/MC50.WAV'),
  tr('Conga high', 'HC/HC50.WAV'),
  vcsl('Conga', `${SM}Conga/Conga_HitN_v1_rr1_Sum.wav`),
  vcsl('Bongo', `${SM}Bongos/BongoH_Hit1_v3_rr1_Mid.wav`),
  vcsl('Concert snare', `${SM}Snare Drum, Modern 1/Snare2_HitNS_v4_rr1_Mid.wav`),
  vcsl('Concert bass drum', `${SM}Bass Drum 2/bassdrum_hit_f.wav`),
  vcsl('Cajón', `${SI}Cajon/Cajon_hit1_f_rr1.wav`),
  vcsl('Claves', `${SI}Claves/Claves1_Hit_v2_rr1_Mid.wav`),
  vcsl('Woodblock', `${SI}Woodblock/wood_click_f_rr1.wav`),
  vcsl('Triangle', `${SI}Triangles/Legacy/1/triangle1_hit_mp.wav`),
  vcsl('Guiro', `${SI}Guiro/Guiro_Med_rr1_Mid.wav`),
  vcsl('Agogo high', `${SI}Agogo Bells/Agogo_High_v2_rr1_Mid.wav`),
  vcsl('Agogo low', `${SI}Agogo Bells/Agogo_Low_v2_rr1_Mid.wav`),
  vcsl('Shaker', `${SI}Shaker, Small/Mid_ShakerDouble_Down_rr1.wav`),
  vcsl('Tambourine', `${SI}Tambourine 1/Tamb1_Hit_v2_rr1_Mid.wav`),
  vcsl('Vibraslap', `${SI}Vibraslap/Legacy/vibraslap_rr1.wav`),
  vcsl('Claps (group)', `${SI}Claps/Clap_rr1.wav`),
  vcsl('Cymbal swell', `${SI}Suspended Cymbal 1/susCymb1_cresc_2s.wav`)
];

export function drumSample(id: string): DrumSample | undefined {
  return DRUM_SAMPLES.find((s) => s.id === id);
}
