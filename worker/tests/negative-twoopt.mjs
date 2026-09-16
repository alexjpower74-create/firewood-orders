// (f) The copy skips 2-opt (nearest neighbour only) → the crossing and local-optimum tests must go red.
import { negative } from './negative-lib.mjs'

process.exit(
  await negative({
    name: 'twoopt',
    why: 'optimizeRoute returns the nearest-neighbour order without 2-opt',
    patches: [
      {
        file: 'src/route.js',
        from: 'return twoOpt(start, nearestNeighbour(start, stops), end)',
        to: 'return nearestNeighbour(start, stops)',
      },
    ],
    args: ['--unit-only', '--unit', 'route.test.mjs'],
    expectRed: [
      'crossing instance: nearest neighbour crosses itself, 2-opt uncrosses it',
      '50 seeded instances: no single segment reversal shortens the result by more than 1 m, and never worse than NN',
    ],
  }),
)
