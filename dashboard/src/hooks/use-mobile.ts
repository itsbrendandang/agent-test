import * as React from "react"

const MOBILE_BREAKPOINT = 768

/** True below 768 px wide: the navigation is then a drawer. Safe where there is no matchMedia (tests). */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    onChange()
    if (typeof window.matchMedia !== "function") {
      window.addEventListener("resize", onChange)
      return () => window.removeEventListener("resize", onChange)
    }
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
