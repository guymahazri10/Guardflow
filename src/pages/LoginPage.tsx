export function LoginPage() {
  return <PagePlaceholder title="התחברות" description="עמוד התחברות (שלד בלבד)." />
}

function PagePlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <section dir="rtl" className="mx-auto w-full max-w-md px-4 py-8 text-right">
      <h2 className="mb-2 text-2xl font-bold text-slate-900">{title}</h2>
      <p className="text-slate-600">{description}</p>
    </section>
  )
}
