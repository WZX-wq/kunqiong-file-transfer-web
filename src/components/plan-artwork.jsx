import React from 'react'
import { HardDrive } from 'lucide-react'
import { ACCOUNT_PLAN_ICON } from '../lib/constants.js'
import free from '../assets/plans/free.webp'
import member from '../assets/plans/member.webp'
import team from '../assets/plans/team.webp'
import halfyear from '../assets/plans/halfyear.webp'
import year from '../assets/plans/year.webp'

const artwork = { free, member, team, halfyear, year }

export function PlanArtwork({ planId, size = 32 }) {
  const source = artwork[planId]
  if (source) return <img className="plan-artwork" data-plan={planId} src={source} width={size} height={size} alt="" aria-hidden="true" draggable={false} />
  const Icon = ACCOUNT_PLAN_ICON[planId] || HardDrive
  return <Icon size={size} strokeWidth={1.8} aria-hidden="true" />
}
