export function MachineSchematic() {
  return (
    <svg
      viewBox="0 0 560 410"
      role="img"
      aria-label="Conceptual blown-film line blueprint, not the confirmed WH-C model"
      className="machine-schematic"
    >
      <defs>
        <pattern
          id="blueprint-grid"
          width="24"
          height="24"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M24 0H0V24"
            fill="none"
            stroke="currentColor"
            strokeWidth=".5"
            opacity=".12"
          />
        </pattern>
      </defs>
      <rect width="560" height="410" fill="url(#blueprint-grid)" />
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      >
        <path d="M102 338H460M205 333V75H357V333M192 75H369M220 75V48H340V75M235 48V31H325V48M205 133H357M205 246H357M205 180H357" />
        <path
          d="M205 75L357 133M357 75L205 133M205 133L357 180M357 133L205 180M205 180L357 246M357 180L205 246M205 246L357 333M357 246L205 333"
          opacity=".35"
        />
        <path d="M238 246L260 89H300L323 246Z" fill="#f5ff80" />
        <path d="M250 246V281H310V246M280 281V306H174V271H121V329H174V306M310 264H390V315H421" />
        <rect x="398" y="305" width="57" height="29" rx="3" fill="#fafafa" />
        <circle cx="426" cy="320" r="9" />
        <path d="M121 276L110 254H143L132 276M243 81H315M220 75H340M220 48H340" />
        <path
          d="M86 145H170V177H214M340 120H416V83H477M335 265H477M235 347V368H94"
          strokeDasharray="4 5"
        />
        <circle cx="215" cy="177" r="4" fill="#ff5b29" stroke="none" />
        <circle cx="340" cy="120" r="4" fill="#ff5b29" stroke="none" />
        <circle cx="335" cy="265" r="4" fill="#ff5b29" stroke="none" />
        <path d="M183 26V337M176 26H190M176 337H190" opacity=".35" />
        <path d="M108 353H457M108 347V359M457 347V359" opacity=".35" />
      </g>
      <g
        fill="currentColor"
        fontFamily="var(--font-mono), monospace"
        fontSize="9"
        letterSpacing=".5"
      >
        <text x="33" y="135">
          PROCESS READINGS
        </text>
        <text x="411" y="71">
          LINE CONTEXT
        </text>
        <text x="402" y="253">
          MAINTENANCE
        </text>
        <text x="35" y="388">
          ONE SHARED RECORD
        </text>
        <text x="246" y="383" fontSize="8" opacity=".6">
          CONCEPT / NOT TO SCALE
        </text>
      </g>
    </svg>
  );
}
