export const metadata = { title: "Fluxy", robots: { index: false } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body style={{ margin: 0, background: "#161414", color: "#f4efea", fontFamily: "system-ui, sans-serif" }}>{children}</body></html>);
}
