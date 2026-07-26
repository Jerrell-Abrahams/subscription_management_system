// Copy to `app/suspended/page.jsx`. The middleware rewrites here when a site is
// suspended. Customize the copy/branding per customer.
export const metadata = { title: 'Site unavailable' };

export default function Suspended() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        fontFamily: 'system-ui, sans-serif',
        color: '#1a1a1a',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '1.5rem', margin: 0 }}>This site is temporarily unavailable</h1>
      <p style={{ color: '#666', maxWidth: '28rem', margin: 0 }}>
        The site is currently offline. If you are the owner, please contact us to restore service.
      </p>
    </main>
  );
}
