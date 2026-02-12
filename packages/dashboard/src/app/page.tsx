import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/cron-jobs');
}
