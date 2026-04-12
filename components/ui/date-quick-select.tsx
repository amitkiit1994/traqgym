"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"
import { todayIST } from "@/lib/utils/date"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

function formatDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

type DateQuickSelectProps = {
  value: string
  onChange: (date: string) => void
  className?: string
}

function DateQuickSelect({ value, onChange, className }: DateQuickSelectProps) {
  const [showCustom, setShowCustom] = useState(false)

  const today = formatDateStr(todayIST())
  const yesterday = (() => {
    const d = todayIST()
    d.setDate(d.getDate() - 1)
    return formatDateStr(d)
  })()
  const last7 = (() => {
    const d = todayIST()
    d.setDate(d.getDate() - 7)
    return formatDateStr(d)
  })()

  const isPreset = value === today || value === yesterday || value === last7
  const activeCustom = !isPreset || showCustom

  return (
    <div data-slot="date-quick-select" className={cn("flex items-center gap-2", className)}>
      <Button
        type="button"
        size="sm"
        variant={value === today && !showCustom ? "default" : "outline"}
        onClick={() => {
          setShowCustom(false)
          onChange(today)
        }}
      >
        Today
      </Button>
      <Button
        type="button"
        size="sm"
        variant={value === yesterday && !showCustom ? "default" : "outline"}
        onClick={() => {
          setShowCustom(false)
          onChange(yesterday)
        }}
      >
        Yesterday
      </Button>
      <Button
        type="button"
        size="sm"
        variant={value === last7 && !showCustom ? "default" : "outline"}
        onClick={() => {
          setShowCustom(false)
          onChange(last7)
        }}
      >
        Last 7 Days
      </Button>
      <Button
        type="button"
        size="sm"
        variant={activeCustom && showCustom ? "default" : "outline"}
        onClick={() => setShowCustom(true)}
      >
        Custom
      </Button>
      {showCustom && (
        <Input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-40"
        />
      )}
    </div>
  )
}

export { DateQuickSelect }
