import { Link } from "react-router-dom";

export default function DownloadBanner() {
  return (
    <div className="bg-gradient-to-r from-purple to-blue text-white">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm">
          This website shows a preview of the credit card catalog. SMS expense tracking, net worth,
          and PRO features are only available in the Android app.
        </p>
        {/* Points at the home page's #download anchor, not a same-page one — this banner also
            renders on Cards/CardDetail, where a bare "#download" href would silently do nothing. */}
        <Link to="/#download" className="bg-white text-purple px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap hover:opacity-90 transition-opacity">
          Download the app →
        </Link>
      </div>
    </div>
  );
}
