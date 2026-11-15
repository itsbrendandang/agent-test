// The Benchmarks page: where we stand against the record (BixBench3, Edison Scientific) and how one agent and the
// team of nine did on the public BixBench v1.5. The card and its numbers are in src/overview/.
import { Benchmarks } from "@/overview/Benchmarks"

export function BenchmarksView() {
  return (
    <div className="page">
      <h1 className="sr-only">Benchmarks</h1>
      <div className="page-head"><div><p className="page-about">Our results on the benchmarks, beside the record. Only runs with real AI models are shown.</p></div></div>
      <Benchmarks />
    </div>
  )
}
