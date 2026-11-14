import { Buddy } from "@/components/Buddy"

interface Props {
  title: string
  hint: string
}

export function PlaceholderView({ title, hint }: Props) {
  return (
    <div className="page">
      <header className="page-head">
        <h1>{title}</h1>
      </header>
      <div className="placeholder card-surface">
        <Buddy seed={title} mood="sleeping" size={110} />
        <h2>{title} goes here</h2>
        <p className="muted small">{hint}</p>
      </div>
    </div>
  )
}
