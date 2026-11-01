// Three looks for the same piano model. Pick one with ?piano=a|b|c (default a).
export const DESIGNS = {
  a: {
    name: 'Concert',
    length: 2.3, // semi-concert grand
    finish: 'white',
    legs: 'turned',
    desk: 'fretwork',
    bench: 'artist',
    glow: false,
  },
  b: {
    name: 'Salon',
    length: 1.75, // baby grand
    finish: 'black',
    legs: 'deco',
    desk: 'slots',
    bench: 'duet',
    glow: false,
  },
  c: {
    name: 'Nocturne',
    length: 2.1,
    finish: 'pearl',
    legs: 'slender',
    desk: 'plain',
    bench: 'curved',
    glow: true,
  },
}

const key = new URLSearchParams(window.location.search).get('piano')
export const designKey = DESIGNS[key] ? key : 'a'
export const design = DESIGNS[designKey]
