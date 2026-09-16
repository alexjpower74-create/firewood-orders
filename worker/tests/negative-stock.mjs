// (c) The copy moves stock when the order is created → the stock test must go red.
import { negative } from './negative-lib.mjs'

const anchor = `        c.nowIso,
        c.nowIso,
      ),
  ])`

process.exit(
  await negative({
    name: 'stock',
    why: 'POST /api/orders also runs UPDATE products SET stock_cu_in = stock_cu_in - wood, stock_bags = stock_bags - bags in its batch',
    patches: [
      {
        file: 'src/index.js',
        from: anchor,
        to: anchor.replace(
          '\n  ])',
          `
    c.db.prepare('UPDATE products SET stock_cu_in = stock_cu_in - ?, stock_bags = stock_bags - ? WHERE id = ?')
      .bind(q.wood_cu_in, q.pellet_bags, input.product.id),
  ])`,
        ),
      },
    ],
    args: ['--api-only', '--grep', '^stock:'],
    expectRed: ['stock: unchanged by order, schedule and start; a delivered 16-inch face cord takes exactly 73 728 cu in'],
  }),
)
