// The thin "Working" bar directly under the header: a sign that the app has taken what was submitted and is
// waiting for the engine. It shows at once while a request that sends something is in flight, and for a read only
// when it has been pending for a while (so background polling never makes it flicker). Once shown it stays long
// enough to be noticed (the rule is useWorking in lib/working.ts). It is indeterminate: it says "working", never
// how far along. Event streams do not count.
/** The bar itself. It takes no room in the layout: it lies on the line under the header. */
export function WorkingBar({ working }: { working: boolean }) {
  return (
    <div className="working-slot">
      {working && <div className="working-bar" role="progressbar" aria-label="Working"><span /></div>}
    </div>
  )
}
