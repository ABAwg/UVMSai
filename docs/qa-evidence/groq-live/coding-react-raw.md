**Typed fix – React + TypeScript**

```tsx
import { useEffect, useState, useRef } from "react";

type SearchResult = {
  id: string;
  title: string;
  // …other fields returned by the API
};

export function Search({ term }: { term: string }) {
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // increments for each request – lets us discard stale responses
  const requestId = useRef(0);
  // tracks component mounted state for the final cleanup
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    // ---- 1. Guard empty query ---------------------------------
    if (!term.trim()) {
      setResults(null);
      setError(null);
      setLoading(false);
      return;               // nothing to fetch
    }

    const controller = new AbortController();
    const signal = controller.signal;
    const currentId = ++requestId.current; // unique id for this request

    setLoading(true);
    setError(null);

    fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal })
      .then(async resp => {
        // ---- 2. HTTP‑level error handling -----------------------
        if (!resp.ok) {
          const txt = await resp.text().catch(() => resp.statusText);
          throw new Error(`Server error ${resp.status}: ${txt}`);
        }
        return resp.json() as Promise<SearchResult[]>;
      })
      .then(data => {
        // ---- 3. Stale‑response guard ----------------------------
        // If a newer request has been started, ignore this result.
        if (requestId.current !== currentId) return;
        // Also abort if component has been unmounted.
        if (!mounted.current) return;
        setResults(data);
      })
      .catch(err => {
        // AbortError is expected when the user types fast → ignore it.
        if (err.name === "AbortError") return;
        // Guard again against stale / unmounted updates
        if (requestId.current !== currentId) return;
        if (!mounted.current) return;
        setError(err.message);
        setResults(null);
      })
      .finally(() => {
        // Only clear the loading flag for the latest request
        if (requestId.current === currentId && mounted.current) {
          setLoading(false);
        }
      });

    // ---- 4. Cleanup – abort on term change or unmount ----------
    return () => {
      controller.abort(); // cancels the network request
    };
  }, [term]); // re‑run when the search term changes
```

### Why `AbortController` alone isn’t enough

`AbortController` only cancels the **network request**.  
If a previous request finishes **before** the abort signal reaches the browser (or the response is already in the promise‑resolution queue), the `fetch` promise resolves and its `.then`/`.catch` callbacks still run. Without an additional guard (the `requestId` check above or a similar “is‑latest” flag), that stale callback will call `setResults`/`setError`, overwriting the newer data that may already have been rendered.

In short: abort stops the *fetch*; it does **not** stop already‑resolved promises from executing their continuation code.

### UI behaviour while a request is pending

* `loading` → `true` → UI can show a spinner, “Searching…”, or disable the results list.
* The previous result set remains visible (or is cleared, depending on UX) until the new data arrives.
* If the user clears the term, the component instantly clears `results` and hides the spinner.
* Errors are displayed only after the request completes and are cleared on the next successful fetch.

This pattern guarantees:

1. No state updates after unmount.  
2. No stale data overwriting fresh results.  
3. Proper handling of HTTP errors and empty queries.  

Feel free to adapt the visual part (`loading` → spinner, `error` → message) to your design system.