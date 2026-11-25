import { Link } from 'react-router-dom'

const privacyEmail = 'guy97735@gmail.com'

export function PrivacyPolicyPage() {
  return (
    <main dir="rtl" className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-8 sm:py-12">
      <Link to="/login" className="font-semibold text-primary underline">חזרה ל־GuardFlow</Link>
      <article className="card mt-5 space-y-6 p-5 text-sm leading-relaxed text-text-secondary sm:p-8">
        <header>
          <h1 className="text-2xl font-bold text-text-primary">מדיניות הפרטיות של GuardFlow</h1>
          <p className="mt-2">GuardFlow מופעלת על ידי גיא מחזרי ומשמשת לניהול משמרות, שיבוץ עובדים ועדכון עמדות בזמן אמת.</p>
        </header>

        <section>
          <h2 className="mb-1 text-lg font-bold text-text-primary">חשבונות והתחברות עם Google</h2>
          <p>כשנכנסים באמצעות Google, שירות ההתחברות של Supabase מקבל מ־Google פרטי חשבון, ובהם מזהה חשבון, כתובת אימייל ופרטי פרופיל בסיסיים. GuardFlow משתמשת בשם ובאימייל כדי לזהות את המשתמש ולקשר אותו לחשבון ולשיבוצים שלו. פרופיל המשתמש נשמר ב־Supabase לצד מזהה פנימי ותפקיד במערכת.</p>
        </section>

        <section>
          <h2 className="mb-1 text-lg font-bold text-text-primary">שיבוצים והתראות</h2>
          <p>המערכת שומרת שמות עובדים, שיוך לחשבונות, זמני משמרות, עמדות והיסטוריית שינויים כדי לנהל ולהציג את סידור העבודה. המידע מוצג למשתמשי GuardFlow בהתאם להרשאותיהם. הפעלת התראות שומרת כתובת מסירה ומפתחות הצפנה של המכשיר כדי לשלוח התראות על שינוי עמדה דרך שירות ההתראות של הדפדפן. אפשר לכבות התראות בפרופיל.</p>
        </section>

        <section>
          <h2 className="mb-1 text-lg font-bold text-text-primary">אחסון וספקי שירות</h2>
          <p>האתר מתארח ב־Vercel. חשבונות, שיבוצים וקובצי סידור שהועלו נשמרים ב־Supabase. כשמשתמשים בייבוא מתמונה, התמונה נשלחת ל־Google Gemini כדי לחלץ את השיבוצים. היא עשויה לכלול שמות עובדים, שעות ועמדות.</p>
        </section>

        <section>
          <h2 className="mb-1 text-lg font-bold text-text-primary">פניות בנושא פרטיות</h2>
          <p>לשאלות על המידע שלך או לבקשה לעיין בו, לתקן אותו או למחוק אותו, אפשר לפנות אל גיא מחזרי בכתובת{' '}
            <a dir="ltr" href={`mailto:${privacyEmail}`} className="font-semibold text-primary underline">{privacyEmail}</a>.
          </p>
        </section>
      </article>
    </main>
  )
}
