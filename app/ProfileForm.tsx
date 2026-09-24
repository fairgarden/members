'use client'

import { useState } from 'react'
import { Alert } from '@fairgarden/design/feedback/alert'
import { Button } from '@fairgarden/design/actions/button'
import { Field, FieldDescription, FieldLabel } from '@fairgarden/design/forms/field'
import { Form, FormActions, FormRow } from '@fairgarden/design/forms/form'
import { Input } from '@fairgarden/design/forms/input'
import { saveProfile } from './actions'

/** The part of a member's profile they fill in themselves. */
export function ProfileForm({
  nickname,
  pronouns,
  bio,
}: {
  nickname: string | null
  pronouns: string | null
  bio: string | null
}) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ error?: string; saved?: boolean }>({})

  const submit = async (values: Record<string, unknown>) => {
    setBusy(true)
    const { error } = await saveProfile(values)
    setResult(error ? { error } : { saved: true })
    setBusy(false)
  }

  return (
    <Form onFormSubmit={submit} busy={busy}>
      {result.error ? (
        <Alert status="danger" title="Couldn't save.">
          {result.error}
        </Alert>
      ) : null}
      {result.saved ? <Alert status="success">Saved.</Alert> : null}
      <FormRow>
        <Field name="nickname">
          <FieldLabel optional>Nickname</FieldLabel>
          <Input defaultValue={nickname ?? ''} autoComplete="nickname" />
        </Field>
        <Field name="pronouns">
          <FieldLabel optional>Pronouns</FieldLabel>
          <Input defaultValue={pronouns ?? ''} placeholder="they/them" />
        </Field>
      </FormRow>
      <Field name="bio">
        <FieldLabel optional>About You</FieldLabel>
        <Input multiline rows={4} limit={1000} defaultValue={bio ?? ''} />
        <FieldDescription>Other members see this.</FieldDescription>
      </Field>
      <FormActions>
        <Button type="submit" variant="solid" disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Saving…' : 'Save Profile'}
        </Button>
      </FormActions>
    </Form>
  )
}
