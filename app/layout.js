import "./globals.css";

export const metadata = {
  title: "🎮 AI 체험관 | Realize Academy",
  description: "Realize Academy 3주차 AI 체험 프로젝트",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>
        {children}
      </body>
    </html>
  );
}
