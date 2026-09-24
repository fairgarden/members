'use client'

import styles from './page.module.css'
import {
  Button,
  PressCallback,
} from '@fairgarden/design/actions/button'
import { useLocale } from '@fairgarden/design/utils/ClientProvider'
import { Alert } from '@fairgarden/design/feedback/alert'
import { useCallback, useState } from 'react'
import { useSearchParams } from 'next/navigation'

export default function Home() {
  let { locale, direction } = useLocale()
  const query = useSearchParams()
  const [test, setTest] = useState(0)
  const callback = useCallback<PressCallback>(() => {
    console.log('test')
    setTest((i) => i + 1)
  }, [setTest])

  console.log(query, locale)

  return (
    <main className={styles.main}>
      <div>
        {test}
        <h1>This is a test!!</h1>
        {locale}
        {direction}
        <Button onPress={callback}>This is a test!</Button>
        <Alert />
      </div>
    </main>
  )
}
