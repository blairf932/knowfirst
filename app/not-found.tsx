import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="error-page">
      <h1>未找到这项情报</h1>
      <p>当前研究范围为 AI Agent 生态。</p>
      <Link href="/">返回工作台</Link>
    </main>
  );
}
