'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="error-page">
      <h1>ERROR · 暂时无法读取情报</h1>
      <p>数据库或服务未准备就绪。请检查终端日志，然后重试。</p>
      <button onClick={reset}>重试</button>
    </main>
  );
}
