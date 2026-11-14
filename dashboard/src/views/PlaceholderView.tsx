import { Buddy } from "@/components/Buddy"
import { PageHead } from "@/components/Shared"

interface Props {
  title: string
  hint: string
}

export function PlaceholderView({ title, hint }: Props) {
  return (
    <div className="page">
      <PageHead title={title} about={hint} />
      <div className="placeholder card-surface">
        <Buddy seed={title} mood="sleeping" size={110} />
        <h2>Nothing here yet</h2>
        <p className="muted small">This view is not built. Use Swarm, Board or Experiments in the side rail.</p>
      </div>
    </div>
  )
}
