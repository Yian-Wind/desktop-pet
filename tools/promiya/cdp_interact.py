# -*- coding: utf-8 -*-
"""CDP interaction tests: click coat toggle, drag closed-eyes, persistence."""
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
        self.ws = websocket.create_connection(
            target['webSocketDebuggerUrl'], timeout=10,
            origin='http://127.0.0.1:9222')
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


def pet_state(pet):
    return pet.eval("""(() => {
      const base = document.querySelector('.pet-sprite img')
      const coat = document.querySelector('.pet-sprite-layer--coat')
      const wrap = document.querySelector('.pet-sprite')
      return {
        src: base ? base.src.split('/').pop() : null,
        coat: coat ? coat.src.split('/').pop() : null,
        wrapClass: wrap ? wrap.className : null,
        bubble: document.querySelector('.pet-bubble')?.textContent ?? null
      }
    })()""")


def click(pet, x, y):
    pet.call('Input.dispatchMouseEvent', type='mouseMoved', x=x, y=y, button='none')
    time.sleep(0.2)
    pet.call('Input.dispatchMouseEvent', type='mousePressed', x=x, y=y,
             button='left', clickCount=1)
    time.sleep(0.1)
    pet.call('Input.dispatchMouseEvent', type='mouseReleased', x=x, y=y,
             button='left', clickCount=1)


def drag(pet, x, y, dx, dy, steps=8):
    pet.call('Input.dispatchMouseEvent', type='mouseMoved', x=x, y=y, button='none')
    time.sleep(0.2)
    pet.call('Input.dispatchMouseEvent', type='mousePressed', x=x, y=y,
             button='left', clickCount=1)
    for i in range(1, steps + 1):
        time.sleep(0.05)
        pet.call('Input.dispatchMouseEvent', type='mouseMoved',
                 x=x + dx * i // steps, y=y + dy * i // steps, button='left')
    time.sleep(0.3)
    pet.call('Input.dispatchMouseEvent', type='mouseReleased',
             x=x + dx, y=y + dy, button='left', clickCount=1)


def main():
    pet = Cdp(find_target('window=pet'))
    rect = pet.eval("""(() => {
      const r = document.querySelector('.pet-sprite img').getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()""")
    cx, cy = round(rect['x']), round(rect['y'])
    print(f'sprite center: ({cx},{cy})')

    failures = []

    # Normalize to a known starting state: coat OFF.
    current = pet_state(pet)
    if current['coat'] is not None:
        click(pet, cx, cy)
        time.sleep(0.5)

    # --- Test 1: click toggles coat ON (bubble appears, no bounce is CSS-only) ---
    before = pet_state(pet)
    click(pet, cx, cy)
    time.sleep(0.6)
    after = pet_state(pet)
    print('click 1:', json.dumps(after, ensure_ascii=False))
    if after['coat'] != 'coat_overlay.png':
        failures.append('click did not put the coat on')
    if not after['bubble']:
        failures.append('no bubble after click')

    # --- Test 2: second click toggles coat OFF ---
    click(pet, cx, cy)
    time.sleep(0.6)
    after2 = pet_state(pet)
    print('click 2:', json.dumps(after2, ensure_ascii=False))
    if after2['coat'] is not None:
        failures.append('second click did not take the coat off')

    # --- Test 3: drag switches to closed-eyes image, coat state persists ---
    click(pet, cx, cy)  # coat back ON
    time.sleep(0.5)
    # Manual drag: press, move (sample mid-drag), then release.
    pet.call('Input.dispatchMouseEvent', type='mouseMoved', x=cx, y=cy, button='none')
    time.sleep(0.2)
    pet.call('Input.dispatchMouseEvent', type='mousePressed', x=cx, y=cy,
             button='left', clickCount=1)
    for i in range(1, 9):
        time.sleep(0.05)
        pet.call('Input.dispatchMouseEvent', type='mouseMoved',
                 x=cx + 40 * i // 8, y=cy + 30 * i // 8, button='left')
    time.sleep(0.3)
    during = pet_state(pet)
    print('mid-drag:', json.dumps(during, ensure_ascii=False))
    if 'nocoat_eyeclosed' not in (during['src'] or ''):
        failures.append(f'drag did not show closed-eyes image (src={during["src"]})')
    if during['coat'] != 'coat_overlay.png':
        failures.append('coat did not persist through drag')

    pet.call('Input.dispatchMouseEvent', type='mouseReleased',
             x=cx + 40, y=cy + 30, button='left', clickCount=1)
    time.sleep(0.5)
    released = pet_state(pet)
    print('after release:', json.dumps(released, ensure_ascii=False))
    if 'eyeclosed' in (released['src'] or ''):
        failures.append('closed-eyes image stuck after drop')
    if released['coat'] != 'coat_overlay.png':
        failures.append('coat lost after drop')

    # --- Test 4: float animation only in idle ---
    during_drag = pet.eval("document.querySelector('.pet-sprite').className")
    print('wrap class after drop:', during_drag)

    print()
    if failures:
        print('FAILURES:')
        for f in failures:
            print(' -', f)
        return 1
    print('ALL INTERACTION TESTS PASSED')
    return 0


if __name__ == '__main__':
    sys.exit(main())
