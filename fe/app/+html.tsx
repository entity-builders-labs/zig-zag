import { ScrollViewStyleReset } from 'expo-router/html';

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang='es'>
      <head>
        <meta charSet='utf-8' />
        <meta httpEquiv='X-UA-Compatible' content='IE=edge' />
        <meta
          name='viewport'
          content='width=device-width, initial-scale=1, shrink-to-fit=no'
        />
        <meta name='theme-color' content='#ffffff' />
        <link rel='manifest' href='/manifest.webmanifest' />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
