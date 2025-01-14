type ObserveIntersection = {
  callback: (entity: IntersectionObserverEntry) => void;
  dispose: () => void;
};

let _intersectionObserver: IntersectionObserver | null = null;
const elementsMap = new WeakMap<Element, Array<ObserveIntersection>>();

// for debugging
if (typeof window !== 'undefined') {
  (window as any)._intersectionObserverElementsMap = elementsMap;
}

/**
 * @internal get or initialize the IntersectionObserver instance
 */
const getIntersectionObserver = () =>
  (_intersectionObserver ??= new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const listeners = elementsMap.get(entry.target) ?? [];
      listeners.forEach(({ callback }) => callback(entry));
    });
  }));

/**
 * @internal remove element's specific listener
 */
const removeListener = (element: Element, listener: ObserveIntersection) => {
  if (!element) return;
  const listeners = elementsMap.get(element) ?? [];
  const observer = getIntersectionObserver();
  // remove the listener from the element
  if (listeners.includes(listener)) {
    elementsMap.set(
      element,
      listeners.filter(l => l !== listener)
    );
  }
  // if no more listeners, unobserve the element
  if (elementsMap.get(element)?.length === 0) {
    observer.unobserve(element);
    elementsMap.delete(element);
  }
};

/**
 * A function to observe the intersection of an element use global IntersectionObserver.
 *
 * ```ts
 * useEffect(() => {
 *  const dispose1 = observeIntersection(elRef1.current, (entry) => {});
 *  const dispose2 = observeIntersection(elRef2.current, (entry) => {});
 *
 *  return () => {
 *   dispose1();
 *   dispose2();
 *  };
 * }, [])
 * ```
 * @return A function to dispose the observer.
 */
export const observeIntersection = (
  element: Element,
  callback: ObserveIntersection['callback']
) => {
  const observer = getIntersectionObserver();
  if (!elementsMap.has(element)) {
    observer.observe(element);
  }
  const prevListeners = elementsMap.get(element) ?? [];
  const listener = { callback, dispose: () => {} };
  listener.dispose = () => removeListener(element, listener);

  elementsMap.set(element, [...prevListeners, listener]);

  return listener.dispose;
};
