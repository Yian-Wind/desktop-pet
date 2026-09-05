# -*- coding: utf-8 -*-
"""CDP-based runtime verification for the Promeia pet window."""
import json
import sys
import time

import requests
import websocket


def find_target(url_part):
    for t in requests.get('http://127.0.0.1:9222/json').json():
        if t['type'] == 'page' and url_part in t['url']:
            return t
    raise SystemExit(f'no target matching {url_part}')


class Cdp:
    def __init__(self, target):
        self.ws = websocket.create_connection(target['webSocketDebuggerUrl'], timeout=10)
        self.msg_id = 0

    def call(self, method, **params):
        self.msg_id += 1
        self.ws.send(json.dumps({'id': self.msg_id, 'method': method, 'params': params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get('id') == self.msg_id:
                if 'error' in msg:
                    raise RuntimeError(msg['error'])
                return msg.get('result', {})

    def eval(self, expression):
        result = self.call('Runtime.evaluate', expression=expression, returnByValue=True)
        return result.get('result', {}).get('value')


def main():
    pet = Cdp(find_target('window=pet'))
    panel = Cdp(find_target('window=panel'))

    info = pet.eval("""(() => {
      const img = document.querySelector('.pet-sprite img, img.pet-sprite')
      const coat = document.querySelector('.pet-sprite-layer--coat')
      const wrap = document.querySelector('.pet-sprite')
      return {
        hasSprite: !!img,
        src: img ? img.src : null,
        complete: img ? img.complete : null,
        natural: img ? [img.naturalWidth, img.naturalHeight] : null,
        wrapClass: wrap ? wrap.className : null,
        coatImg: coat ? coat.src : null,
        rootClass: document.querySelector('.pet-root')?.className ?? null
      }
    })()""")
    print('pet render state:', json.dumps(info, ensure_ascii=False, indent=1))

    packs = panel.eval("window.petApi ? 'api-ok' : 'no-api'")
    print('panel api:', packs)

    # position + bounds of the sprite for input dispatch
    rect = pet.eval("""(() => {
      const img = document.querySelector('.pet-sprite img, img.pet-sprite')
      if (!img) return null
      const r = img.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height,
               cw: window.innerWidth, ch: window.innerHeight }
    })()""")
    print('sprite rect:', json.dumps(rect))
    return 0


if __name__ == '__main__':
    sys.exit(main())
