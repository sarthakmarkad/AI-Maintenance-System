import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  Activity,
  BellRing,
  BookOpen,
  CalendarDays,
  ClipboardList,
  FileChartColumn,
  ScanLine,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { LandingVideo } from "@/components/landing-video";
const features = [
  {
    icon: ClipboardList,
    title: "Work with a clear next step.",
    text: "Report an issue, assign the right technician and keep findings, evidence and approvals together.",
    tag: "Work orders & evidence",
  },
  {
    icon: CalendarDays,
    title: "Make routine work a routine.",
    text: "Plan recurring maintenance on fixed calendar dates. Release tasks and keep upcoming work in view.",
    tag: "Planning & reminders",
  },
  {
    icon: Activity,
    title: "Put patterns in perspective.",
    text: "Explore production records and synthetic process trends. Review signals before opening an investigation.",
    tag: "Production & process trends",
  },
  {
    icon: BookOpen,
    title: "Keep the right reference close.",
    text: "Give your team a private library of approved manuals and SOPs, with retained versions and review history.",
    tag: "Manuals & SOPs",
  },
  {
    icon: Sparkles,
    title: "A second pair of eyes.",
    text: "Ask the assistant about approved references or draft an evidence-based RCA. Your team makes the decisions.",
    tag: "Advisory AI assistance",
  },
  {
    icon: FileChartColumn,
    title: "Keep every handoff connected.",
    text: "Follow maintenance history, export reports and receive in-app or opted-in email alerts when work needs attention.",
    tag: "Reports & notifications",
  },
];
export default function Home() {
  return (
    <div className="landing">
      <a href="#landing-content" className="skip-link">
        Skip to content
      </a>
      <div className="landing-announcement">
        <span className="signal-square" /> MACHINE MAINTENANCE{" "}
        <span className="announcement-divider">/</span> Your machines. Connected
        maintenance workspaces.
      </div>
      <header className="landing-header">
        <Link
          href="/"
          className="brand landing-brand"
          aria-label="Supreme home"
        >
          <span className="brand-mark">
            <ScanLine size={25} />
          </span>
          <span>
            SUPREME<small>Maintenance intelligence</small>
          </span>
        </Link>
        <nav aria-label="Website navigation">
          <a href="#platform">Platform</a>
          <a href="#workflow">How it works</a>
          <Link href="/machines" className="landing-dashboard">
            Dashboard <ArrowRight size={16} />
          </Link>
        </nav>
      </header>
      <main id="landing-content" tabIndex={-1}>
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <div className="mono-label">
              <span className="signal-square" /> ENGINEERED FOR THE EVERYDAY
            </div>
            <h1>
              Less guesswork.
              <br />
              <span>More forward.</span>
            </h1>
            <p>
              Your machine records, maintenance work and team knowledge.
              Connected in one place, so the next decision starts with better
              context.
            </p>
            <div className="landing-hero-actions">
              <Link href="/machines" className="button button-primary">
                Enter your dashboard <ArrowRight size={17} />
              </Link>
              <a href="#platform" className="landing-text-link">
                Explore the platform <ArrowDown size={16} />
              </a>
            </div>
            <div className="landing-access-note">
              <ShieldCheck size={15} /> Secure team access. Decisions stay with
              your people.
            </div>
          </div>
          <LandingVideo />
        </section>
        <div className="landing-context">
          <span>BUILT AROUND YOUR OPERATION</span>
          <strong>Supreme Industries</strong>
          <span>Windmöller & Hölscher</span>
          <span>Machine workspaces</span>
        </div>
        <section id="platform" className="landing-platform">
          <div className="landing-section-heading">
            <div>
              <div className="mono-label">THE PLATFORM / 01</div>
              <h2>
                The whole picture.
                <br />
                <span>Without the paper chase.</span>
              </h2>
            </div>
            <p>
              From the first observation to the final review, keep the work and
              its context moving together.
            </p>
          </div>
          <div className="landing-feature-grid">
            {features.map(({ icon: Icon, title, text, tag }, i) => (
              <article className="landing-feature" key={title}>
                <div className="landing-feature-top">
                  <Icon size={26} strokeWidth={1.4} />
                  <span>0{i + 1}</span>
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
                <span className="feature-tag">{tag}</span>
              </article>
            ))}
          </div>
        </section>
        <section id="workflow" className="landing-workflow">
          <div className="landing-section-heading">
            <div>
              <div className="mono-label">HOW IT WORKS / 02</div>
              <h2>A handoff, not a dead end.</h2>
            </div>
            <p>
              A clear owner at each step. A shared record all the way through.
            </p>
          </div>
          <ol>
            {[
              {
                title: "Report",
                role: "Operator or technician",
                text: "Record what happened and attach the evidence.",
              },
              {
                title: "Assign",
                role: "Maintenance head",
                text: "Review the issue and choose an eligible technician.",
              },
              {
                title: "Inspect & repair",
                role: "Assigned technician",
                text: "Record findings, work performed and restoration.",
              },
              {
                title: "Review & close",
                role: "Head / supervisor",
                text: "The head approves; the head or supervisor closes.",
              },
            ].map((step, i) => (
              <li key={step.title}>
                <span className="workflow-number">0{i + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
                <span>{step.role}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="landing-cta">
          <div className="mono-label">
            <BellRing size={16} /> READY FOR THE NEXT SHIFT
          </div>
          <h2>
            Good maintenance starts
            <br />
            with a clearer view.
          </h2>
          <Link href="/machines" className="button button-primary">
            Open dashboard <ArrowRight size={18} />
          </Link>
          <p>Sign in with your approved team account.</p>
        </section>
      </main>
      <footer className="landing-footer">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <ScanLine size={23} />
          </span>
          <span>
            SUPREME<small>Maintenance intelligence</small>
          </span>
        </Link>
        <span>Machine maintenance · Built for informed decisions.</span>
        <a href="#landing-content">Back to top ↑</a>
      </footer>
    </div>
  );
}
