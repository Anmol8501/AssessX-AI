import { useState, type FormEvent, type ReactNode } from 'react'
import { AlertIcon, CheckIcon, InfoIcon } from '@/components/icons'
import { Button, Card, CardBody, CardHeader, Checkbox, Field, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { LockedNotice } from './LockedNotice'
import { NAVIGATION_LABEL, type AssessmentDetail, type AssessmentPatch, type QuestionNavigation } from '../types'

const NAVIGATION_OPTIONS: QuestionNavigation[] = ['FREE', 'SEQUENTIAL']

/** `2026-10-01T09:00:00Z` → `2026-10-01T09:00`, the format a datetime-local input expects. */
function toLocalInput(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function toIso(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

interface SettingsSectionProps {
  /** Published assessments are locked; settings are shown but cannot be saved. */
  locked?: boolean
  assessment: AssessmentDetail
  saving: boolean
  error: string | null
  saved: boolean
  onSave(patch: AssessmentPatch): void
}

export function SettingsSection({ assessment, saving, error, saved, locked = false, onSave }: SettingsSectionProps) {
  const { settings } = assessment
  const [attempts, setAttempts] = useState(String(settings.max_attempts))
  const [randomizeQuestions, setRandomizeQuestions] = useState(settings.randomize_questions)
  const [randomizeOptions, setRandomizeOptions] = useState(settings.randomize_options)
  const [showResults, setShowResults] = useState(settings.show_results)
  const [navigation, setNavigation] = useState<QuestionNavigation>(settings.question_navigation)
  const [proctoring, setProctoring] = useState(settings.proctoring_required)
  const [requireRegisteredDevice, setRequireRegisteredDevice] = useState(
    settings.require_registered_device ?? false,
  )
  const [secondaryCameraEnabled, setSecondaryCameraEnabled] = useState(settings.secondary_camera_enabled ?? false)
  const [secondaryCameraMandatory, setSecondaryCameraMandatory] = useState(settings.secondary_camera_mandatory ?? false)
  const [secondaryCameraOrientation, setSecondaryCameraOrientation] = useState<'LANDSCAPE' | 'PORTRAIT' | 'ANY'>(
    settings.secondary_camera_orientation ?? 'LANDSCAPE'
  )
  const [secondaryCameraGracePeriod, setSecondaryCameraGracePeriod] = useState(
    String(settings.secondary_camera_grace_period_seconds ?? 60)
  )
  const [start, setStart] = useState(toLocalInput(settings.availability_start))
  const [end, setEnd] = useState(toLocalInput(settings.availability_end))
  const [customInput, setCustomInput] = useState(settings.coding_allow_custom_input)
  const [allowPaste, setAllowPaste] = useState(settings.coding_allow_paste)
  const [maxSubmissions, setMaxSubmissions] = useState(String(settings.coding_max_submissions))
  const coding = assessment.assessment_type !== 'MCQ'
  const [errors, setErrors] = useState<{ max_attempts?: string; availability_end?: string; coding_max_submissions?: string }>({})

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const attemptsValue = Number(attempts)
    const next: typeof errors = {}
    if (!Number.isInteger(attemptsValue) || attemptsValue < 1) next.max_attempts = 'Allow at least one attempt.'
    if (start && end && new Date(end) <= new Date(start)) next.availability_end = 'The end must be after the start.'
    const submissionsValue = Number(maxSubmissions)
    if (coding && (!Number.isInteger(submissionsValue) || submissionsValue < 1 || submissionsValue > 1000)) {
      next.coding_max_submissions = 'Allow between 1 and 1000 submissions.'
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return

    onSave({
      max_attempts: attemptsValue,
      randomize_questions: randomizeQuestions,
      randomize_options: randomizeOptions,
      show_results: showResults,
      question_navigation: navigation,
      proctoring_required: proctoring,
      require_registered_device: requireRegisteredDevice,
      secondary_camera_enabled: proctoring && secondaryCameraEnabled,
      secondary_camera_mandatory: proctoring && secondaryCameraEnabled && secondaryCameraMandatory,
      secondary_camera_orientation: secondaryCameraOrientation,
      secondary_camera_grace_period_seconds: Number(secondaryCameraGracePeriod) || 60,
      availability_start: toIso(start),
      availability_end: toIso(end),
      ...(coding ? { coding_allow_custom_input: customInput, coding_allow_paste: allowPaste, coding_max_submissions: submissionsValue } : {}),
    })
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="max-w-2xl space-y-4" aria-label="Assessment settings">
      {locked && <LockedNotice />}
      {error && (
        <div className="border-danger/30 bg-danger-soft text-danger flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]" role="alert">
          <AlertIcon className="mt-0.5 shrink-0 text-[15px]" />
          {error}
        </div>
      )}

      <Card>
        <CardHeader title="Attempts and navigation" description="How a candidate will move through the exam." />
        <CardBody className="space-y-4">
          <Field label="Maximum attempts" error={errors.max_attempts} hint="How many times a candidate may take this assessment.">
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="number"
                min={1}
                className="max-w-[160px]"
                value={attempts}
                onChange={(e) => setAttempts(e.target.value)}
                aria-describedby={describedBy}
                invalid={invalid}
                disabled={saving}
              />
            )}
          </Field>

          <Field label="Question navigation">
            {({ id }) => (
              <select
                id={id}
                value={navigation}
                onChange={(e) => setNavigation(e.target.value as QuestionNavigation)}
                disabled={saving}
                className="border-line-strong bg-card text-ink hover:border-ink-subtle focus:border-accent focus:ring-accent-ring h-10 w-full rounded-md border px-3 text-[14px] transition-colors focus:ring-2 focus:outline-none"
              >
                {NAVIGATION_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {NAVIGATION_LABEL[option]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Presentation" description="Randomisation and what a candidate sees afterwards." />
        <CardBody className="space-y-3">
          <Toggle label="Randomise question order" checked={randomizeQuestions} onChange={setRandomizeQuestions} disabled={saving} />
          <Toggle label="Randomise option order" checked={randomizeOptions} onChange={setRandomizeOptions} disabled={saving} />
          <Toggle label="Show results to the candidate after submission" checked={showResults} onChange={setShowResults} disabled={saving} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Proctoring Configuration" description="Configure proctoring and multi-camera monitoring for this assessment." />
        <CardBody className="space-y-4">
          <Toggle
            label="Enable proctoring for this exam"
            checked={proctoring}
            onChange={(val) => {
              setProctoring(val)
              if (!val) setSecondaryCameraEnabled(false)
            }}
            disabled={saving}
          />
          <Toggle
            label="Require admin-approved registered desktop workstation"
            checked={requireRegisteredDevice}
            onChange={setRequireRegisteredDevice}
            disabled={saving}
          />

          {proctoring && (
            <div className="space-y-4 pt-2">
              <div className="grid gap-3 sm:grid-cols-2">
                {/* Option A: Standard Proctoring */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setSecondaryCameraEnabled(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSecondaryCameraEnabled(false)
                    }
                  }}
                  className={cn(
                    'cursor-pointer rounded-lg border p-3.5 transition-all focus:outline-none focus:ring-2 focus:ring-accent',
                    !secondaryCameraEnabled
                      ? 'border-accent bg-accent/5 ring-1 ring-accent'
                      : 'border-line hover:border-line-strong hover:bg-hover',
                  )}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[13.5px] font-semibold text-ink">Option A: Standard Proctoring</span>
                    {!secondaryCameraEnabled && (
                      <span className="rounded-full bg-accent text-white text-[10.5px] font-bold px-2 py-0.5">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-ink-subtle leading-relaxed">
                    Use the standard AssessX proctoring system with the candidate's computer camera, microphone, and existing monitoring features.
                  </p>
                </div>

                {/* Option B: Standard Proctoring + Secondary Camera */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setSecondaryCameraEnabled(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSecondaryCameraEnabled(true)
                    }
                  }}
                  className={cn(
                    'cursor-pointer rounded-lg border p-3.5 transition-all focus:outline-none focus:ring-2 focus:ring-accent',
                    secondaryCameraEnabled
                      ? 'border-accent bg-accent/5 ring-1 ring-accent'
                      : 'border-line hover:border-line-strong hover:bg-hover',
                  )}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[13.5px] font-semibold text-ink flex items-center gap-1.5">
                      Option B: Proctoring + Secondary Camera
                      <span className="rounded bg-ok-soft text-ok text-[10px] font-semibold px-1.5 py-0.2">NEW</span>
                    </span>
                    {secondaryCameraEnabled && (
                      <span className="rounded-full bg-accent text-white text-[10.5px] font-bold px-2 py-0.5">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-ink-subtle leading-relaxed">
                    Require candidates to connect an additional mobile phone camera via QR code to monitor their examination environment from a second angle.
                  </p>
                </div>
              </div>

              {/* Secondary Camera Settings (revealed when Option B is active) */}
              {secondaryCameraEnabled && (
                <div className="rounded-lg border border-line-strong bg-card-muted/30 p-4 space-y-4">
                  <div className="flex items-center justify-between border-b border-line pb-2.5">
                    <div>
                      <h4 className="text-[13.5px] font-semibold text-ink">Secondary Camera Settings</h4>
                      <p className="text-[11.5px] text-ink-subtle">Configuration for mobile QR pairing and room view</p>
                    </div>
                    <span className="text-[11px] font-mono text-accent bg-accent-soft px-2 py-0.5 rounded">
                      QR Code Pairing
                    </span>
                  </div>

                  <div className="space-y-3">
                    <Toggle
                      label="Mandatory mobile camera connection"
                      checked={secondaryCameraMandatory}
                      onChange={setSecondaryCameraMandatory}
                      disabled={saving}
                    />
                    <p className="text-[11.5px] text-ink-subtle -mt-1 pl-1">
                      When enabled, candidate cannot start or resume exam until mobile camera is verified and streaming.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                      <Field label="Camera orientation" hint="Recommended orientation on candidate's phone.">
                        {({ id }) => (
                          <select
                            id={id}
                            value={secondaryCameraOrientation}
                            onChange={(e) => setSecondaryCameraOrientation(e.target.value as any)}
                            disabled={saving}
                            className="border-line-strong bg-card text-ink h-9 w-full rounded-md border px-3 text-[13px] transition-colors focus:border-accent focus:outline-none"
                          >
                            <option value="LANDSCAPE">Landscape (Preferred)</option>
                            <option value="PORTRAIT">Portrait</option>
                            <option value="ANY">Any Orientation</option>
                          </select>
                        )}
                      </Field>

                      <Field label="Connection grace period (seconds)" hint="Reconnection allowance if phone temporarily disconnects.">
                        {({ id }) => (
                          <Input
                            id={id}
                            type="number"
                            min={10}
                            max={600}
                            className="h-9 text-[13px]"
                            value={secondaryCameraGracePeriod}
                            onChange={(e) => setSecondaryCameraGracePeriod(e.target.value)}
                            disabled={saving}
                          />
                        )}
                      </Field>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11.5px] text-ink-subtle">
                      <div className="flex items-center gap-1.5 rounded border border-line bg-card/60 p-2">
                        <CheckIcon className="text-ok shrink-0 text-[13px]" />
                        <span>Adaptive Quality</span>
                      </div>
                      <div className="flex items-center gap-1.5 rounded border border-line bg-card/60 p-2">
                        <CheckIcon className="text-ok shrink-0 text-[13px]" />
                        <span>Auto-Reconnection</span>
                      </div>
                      <div className="flex items-center gap-1.5 rounded border border-line bg-card/60 p-2">
                        <CheckIcon className="text-ok shrink-0 text-[13px]" />
                        <span>Positioning Guide</span>
                      </div>
                      <div className="flex items-center gap-1.5 rounded border border-line bg-card/60 p-2">
                        <CheckIcon className="text-ok shrink-0 text-[13px]" />
                        <span>Stream Verification</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <Note>
                Candidates must allow camera and microphone access and pass device checks before the exam starts.
                {secondaryCameraEnabled && ' With secondary camera enabled, candidates will scan a QR code using their mobile phone to stream a side angle of their examination environment.'}
              </Note>
            </div>
          )}
        </CardBody>
      </Card>

      {coding && (
        <Card>
          <CardHeader title="Coding" description="Rules for the coding problems in this assessment. The server enforces them." />
          <CardBody className="space-y-4">
            <Checkbox
              label="Allow candidates to run their code on their own input (otherwise only on the sample tests)"
              checked={customInput}
              onChange={(e) => setCustomInput(e.target.checked)}
              disabled={saving || locked}
            />
            <Checkbox
              label="Allow copy and paste inside the code editor"
              checked={allowPaste}
              onChange={(e) => setAllowPaste(e.target.checked)}
              disabled={saving || locked}
            />
            <Note>
              Copy, cut and paste stay blocked everywhere else in the exam. When this is on, each paste into the editor is
              logged as a fact (its length, never its text) on a proctored attempt.
            </Note>
            <Field label="Submissions per problem" error={errors.coding_max_submissions} hint="Each submission runs against every test, hidden ones included.">
              {({ id, describedBy, invalid }) => (
                <Input id={id} type="number" min={1} max={1000} value={maxSubmissions} onChange={(e) => setMaxSubmissions(e.target.value)} aria-describedby={describedBy} invalid={invalid} disabled={saving || locked} />
              )}
            </Field>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Availability" description="Optional window during which the exam may be taken." />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Available from" hint="Optional.">
              {({ id }) => (
                <Input id={id} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} disabled={saving} />
              )}
            </Field>
            <Field label="Available until" error={errors.availability_end} hint="Optional.">
              {({ id, describedBy, invalid }) => (
                <Input id={id} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} aria-describedby={describedBy} invalid={invalid} disabled={saving} />
              )}
            </Field>
          </div>
          <Note>
            These settings are stored now and applied when candidates take the exam in a later phase. Nothing opens or
            closes automatically yet.
          </Note>
        </CardBody>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <span className={cn('text-ok flex items-center gap-1.5 text-[13px] transition-opacity', saved ? 'opacity-100' : 'opacity-0')} role="status">
          <CheckIcon className="text-[15px]" />
          Saved
        </span>
        <Button type="submit" loading={saving} disabled={locked}>
          Save settings
        </Button>
      </div>
    </form>
  )
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange(value: boolean): void
  disabled?: boolean
}) {
  return <Checkbox label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="text-ink-subtle flex items-start gap-2 text-[12.5px]">
      <InfoIcon className="mt-0.5 shrink-0 text-[14px]" />
      {children}
    </p>
  )
}
