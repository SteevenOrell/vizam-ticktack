import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { HeaderScrollProvider } from '../HeaderScreen';
import { createPager, ENTER_TIMEOUT_MS, SwipePager, type PagerMotion } from '../SwipePager';

/** Records the motion steps; the slide-out finishes only when the test says so. */
function fakeMotion() {
  const log: string[] = [];
  let finishOut: (() => void) | null = null;
  let finishIn: (() => void) | null = null;
  const motion: PagerMotion = {
    slideOut: (x, toValue, done) => {
      log.push(`out ${toValue}`);
      finishOut = () => {
        x.setValue(toValue);
        done();
      };
    },
    slideIn: (x, done) => {
      log.push(`in from ${(x as unknown as { __getValue: () => number }).__getValue()}`);
      finishIn = () => {
        x.setValue(0);
        done();
      };
    },
    settle: () => log.push('settle'),
  };
  return { log, motion, out: () => finishOut?.(), in: () => finishIn?.() };
}

describe('SwipePager transition', () => {
  afterEach(() => jest.useRealTimers());

  it('swaps the content off screen and enters only when the new page is committed', () => {
    const m = fakeMotion();
    const pager = createPager(m.motion);
    const onPage = jest.fn();
    pager.setProps({ onPage, enabled: true, width: 400 });

    pager.slide(1);
    expect(m.log).toEqual(['out -400']);
    expect(onPage).not.toHaveBeenCalled(); // the old page is still visible while it leaves
    m.out();
    expect(onPage).toHaveBeenCalledWith(1);
    // The old page stays off screen: no slide-in yet, so it cannot flash back before the new content renders.
    expect(m.log).toEqual(['out -400']);
    expect(pager.busy).toBe(true);

    pager.pageShown();
    expect(m.log).toEqual(['out -400', 'in from 400']); // enters from the right
    m.in();
    expect(pager.busy).toBe(false);
    pager.dispose();
  });

  it('applies a change requested mid-transition at once, and enters anyway if no new page arrives', () => {
    jest.useFakeTimers();
    const m = fakeMotion();
    const pager = createPager(m.motion);
    const onPage = jest.fn();
    pager.setProps({ onPage, enabled: true, width: 300 });

    const today = jest.fn();
    pager.slide(-1, today);
    pager.slide(-1); // a second arrow tap while sliding
    expect(onPage).toHaveBeenCalledWith(-1);
    m.out();
    expect(today).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(ENTER_TIMEOUT_MS);
    expect(m.log).toEqual(['out 300', 'in from -300']);
    pager.dispose();
  });
});

describe('SwipePager scroll reset', () => {
  const scroll = { scrollToIn: jest.fn(), setScrollEnabled: jest.fn(), scrollToTop: jest.fn() };
  const ui = (pageKey: string, resetScroll: boolean) => (
    <HeaderScrollProvider value={scroll}>
      <SwipePager onPage={jest.fn()} pageKey={pageKey} resetScroll={resetScroll} keyboard={false}>
        <Text>{pageKey}</Text>
      </SwipePager>
    </HeaderScrollProvider>
  );

  beforeEach(() => scroll.scrollToTop.mockClear());

  it('scrolls the screen to the top when a new page is shown, not on first render', async () => {
    const view = await render(ui('week:2026-11-09', true));
    expect(scroll.scrollToTop).not.toHaveBeenCalled();
    await view.rerender(ui('week:2026-11-09', true));
    expect(scroll.scrollToTop).not.toHaveBeenCalled();
    await view.rerender(ui('week:2026-11-16', true));
    expect(scroll.scrollToTop).toHaveBeenCalledTimes(1);
  });

  it('leaves the scroll to the hour grid when resetScroll is off', async () => {
    const view = await render(ui('day:2026-11-09', false));
    await view.rerender(ui('day:2026-11-10', false));
    expect(scroll.scrollToTop).not.toHaveBeenCalled();
  });
});
