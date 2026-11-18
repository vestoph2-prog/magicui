"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { flushSync } from "react-dom"

import { cn } from "@/lib/utils"
import { useMetaColor } from "@/hooks/use-meta-color"

const TRANSITION_DURATION = 650
const THUMB_TRANSITION_NAME = "theme-switch-thumb"

// Percent-based clip-path: absolute px coordinates on ::view-transition-new(root)
// can land in the wrong place on fractional display scales (see #989).
function getCircleClipPath(x: number, y: number) {
  const width = window.innerWidth
  const height = window.innerHeight
  const maxRadius = Math.hypot(Math.max(x, width - x), Math.max(y, height - y))
  // circle() percentage radii resolve against hypot(w, h) / sqrt(2).
  const radius = (maxRadius / (Math.hypot(width, height) / Math.SQRT2)) * 100
  const at = `${(x / width) * 100}% ${(y / height) * 100}%`

  return [`circle(0% at ${at})`, `circle(${radius}% at ${at})`]
}

export function ModeToggle() {
  const { setTheme, resolvedTheme } = useTheme()
  const { setMetaColor, metaColor } = useMetaColor()
  const [mounted, setMounted] = React.useState(false)
  const switchRef = React.useRef<HTMLButtonElement>(null)
  const thumbRef = React.useRef<HTMLSpanElement>(null)
  const isTransitioningRef = React.useRef(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  React.useEffect(() => {
    setMetaColor(metaColor)
  }, [metaColor, setMetaColor])

  const isDark = mounted && resolvedTheme === "dark"

  const toggleTheme = React.useCallback(() => {
    const switchEl = switchRef.current
    const thumb = thumbRef.current
    const root = document.documentElement
    if (!(switchEl && thumb) || isTransitioningRef.current) {
      return
    }

    const nextTheme = root.classList.contains("dark") ? "light" : "dark"

    const applyTheme = () => {
      // Flip the class synchronously so the view transition snapshots the
      // new theme; next-themes then persists the choice.
      root.classList.toggle("dark", nextTheme === "dark")
      root.style.colorScheme = nextTheme
      setTheme(nextTheme)
    }

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches

    if (
      typeof document.startViewTransition !== "function" ||
      prefersReducedMotion
    ) {
      applyTheme()
      return
    }

    const { top, left, width, height } = switchEl.getBoundingClientRect()
    const clipPath = getCircleClipPath(left + width / 2, top + height / 2)

    // Freeze CSS transitions so the "new" snapshot captures final colors,
    // and lift the thumb into its own group so it slides across the track.
    const freeze = document.createElement("style")
    freeze.textContent = "*,*::before,*::after{transition:none!important}"
    document.head.appendChild(freeze)
    thumb.style.viewTransitionName = THUMB_TRANSITION_NAME

    root.dataset.magicuiThemeVt = "active"
    root.style.setProperty(
      "--magicui-theme-toggle-vt-duration",
      `${TRANSITION_DURATION}ms`
    )
    root.style.setProperty("--magicui-theme-vt-clip-from", clipPath[0])
    isTransitioningRef.current = true

    const cleanup = () => {
      isTransitioningRef.current = false
      freeze.remove()
      thumb.style.removeProperty("view-transition-name")
      delete root.dataset.magicuiThemeVt
      root.style.removeProperty("--magicui-theme-toggle-vt-duration")
      root.style.removeProperty("--magicui-theme-vt-clip-from")
    }

    const transition = document.startViewTransition(() => {
      flushSync(applyTheme)
    })

    transition.ready
      .then(() => {
        root.animate(
          { clipPath },
          {
            duration: TRANSITION_DURATION,
            easing: "cubic-bezier(0.65, 0, 0.35, 1)",
            fill: "forwards",
            pseudoElement: "::view-transition-new(root)",
          }
        )
      })
      .catch(() => {
        // Transition was skipped; the theme is already applied.
      })

    transition.finished.finally(cleanup).catch(() => {
      // Nothing to recover: cleanup already ran.
    })
  }, [setTheme])

  return (
    <button
      type="button"
      role="switch"
      ref={switchRef}
      aria-checked={isDark}
      aria-label="Dark mode"
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggleTheme}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full p-0.5",
        "shadow-[inset_0_1px_2px_rgb(0_0_0/0.15)] transition-colors duration-300",
        "focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]",
        isDark ? "bg-zinc-700" : "bg-zinc-200"
      )}
    >
      <span
        ref={thumbRef}
        className={cn(
          "pointer-events-none flex size-5 items-center justify-center rounded-full bg-white",
          "shadow-[0_1px_3px_rgb(0_0_0/0.25),0_1px_1px_rgb(0_0_0/0.1)]",
          "transition-transform duration-300 ease-[cubic-bezier(0.65,0,0.35,1)]",
          isDark ? "translate-x-5" : "translate-x-0"
        )}
      >
        {isDark ? (
          <Moon className="size-3 text-zinc-800" strokeWidth={2.5} />
        ) : (
          <Sun className="size-3 text-amber-500" strokeWidth={2.5} />
        )}
      </span>
    </button>
  )
}
