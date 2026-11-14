/**
 * Vitest setup: DOM matchers plus the browser APIs the editor touches that jsdom
 * does not implement (matchMedia for the theme provider, ResizeObserver for React
 * Flow's measurement hooks and IntersectionObserver for lazy panels).
 */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!window.IntersectionObserver) {
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
}

if (!window.DOMMatrix) {
  window.DOMMatrix = class {
    constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; }
  };
}

afterEach(() => cleanup());
