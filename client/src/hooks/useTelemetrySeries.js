import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChannel } from '../ws/useChannel.js';

/**
 * Buffered live series for charts and stat cards.
 *
 * Performance contract: incoming WebSocket messages are appended to a ref buffer and
 * flushed into React state at most once every `flushMs` (default 200 ms) via a
 * throttled timer — a device at 100 msg/s causes ~5 re-renders per second, not 100.
 * Everything else (stats, messages/sec) is derived with useMemo from the flushed
 * points, so no per-message computation touches the render path.
 *
 * @param {string | null} channel channel to follow (e.g. "telemetry:turbine-001")
 * @param {{ maxPoints?: number, flushMs?: number, sensorType?: string | null,
 *           valueFilter?: (reading: object) => boolean }} [options]
 * @returns {{ points: { t: number, v: number, unit: string }[], stats: object,
 *             messagesPerSecond: number, latest: object | null, pointCount: number }}
 */
export function useTelemetrySeries(channel, options = {}) {
  const { maxPoints = 60, flushMs = 200, sensorType = null, valueFilter = null } = options;
  const [points, setPoints] = useState([]);
  const [messagesPerSecond, setMessagesPerSecond] = useState(0);

  const bufferRef = useRef([]);       // pending points not yet in state
  const timesRef = useRef([]);        // receive timestamps for the mps figure
  const timerRef = useRef(null);      // pending flush timer (throttle)
  const lastFlushRef = useRef(0);
  const maxPointsRef = useRef(maxPoints);
  maxPointsRef.current = maxPoints;

  const flush = useCallback(() => {
    timerRef.current = null;
    lastFlushRef.current = performance.now();
    const pending = bufferRef.current;
    if (pending.length === 0) return;
    bufferRef.current = [];
    setPoints((current) => {
      const next = current.concat(pending);
      return next.length > maxPointsRef.current ? next.slice(next.length - maxPointsRef.current) : next;
    });
    // Messages-per-second over a rolling 1 s window (pruned on every flush).
    const now = Date.now();
    timesRef.current = timesRef.current.filter((t) => now - t <= 1000);
    setMessagesPerSecond(timesRef.current.length);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current !== null) return;
    const wait = Math.max(0, flushMs - (performance.now() - lastFlushRef.current));
    timerRef.current = setTimeout(flush, wait);
  }, [flush, flushMs]);

  useChannel(channel, useCallback((message) => {
    const readings = Array.isArray(message.data) ? message.data : [message.data];
    for (const reading of readings) {
      if (!reading || typeof reading.value !== 'number' || !Number.isFinite(reading.value)) continue;
      if (sensorType && reading.metadata?.sensorType !== sensorType) continue;
      if (valueFilter && !valueFilter(reading)) continue;
      bufferRef.current.push({
        t: reading.timestamp ? new Date(reading.timestamp).getTime() : Date.now(),
        v: reading.value,
        unit: reading.unit ?? '',
      });
      timesRef.current.push(Date.now());
    }
    if (bufferRef.current.length > maxPointsRef.current * 8) {
      bufferRef.current = bufferRef.current.slice(-maxPointsRef.current * 4);
    }
    scheduleFlush();
  }, [sensorType, valueFilter, scheduleFlush, maxPointsRef]));

  // Safety net: even a quiet stream is flushed within one window; timers are cleared
  // on unmount so nothing keeps the component alive.
  useEffect(() => {
    const interval = setInterval(scheduleFlush, flushMs);
    return () => {
      clearInterval(interval);
      clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [scheduleFlush, flushMs]);

  const stats = useMemo(() => {
    if (points.length === 0) return { latest: null, average: null, min: null, max: null };
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const p of points) {
      if (p.v < min) min = p.v;
      if (p.v > max) max = p.v;
      sum += p.v;
    }
    return {
      latest: points[points.length - 1],
      average: sum / points.length,
      min,
      max,
    };
  }, [points]);

  return { points, stats, messagesPerSecond, latest: stats.latest, pointCount: points.length };
}
