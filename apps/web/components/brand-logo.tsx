import Image from "next/image";

/** Owner-supplied icon and wordmark, arranged as a compact accessible identity. */
export function BrandLogo() {
  return (
    <>
      <Image
        className="brand-logo-icon"
        src="/brand/maintenate-icon-transparent.png"
        width={1274}
        height={1235}
        alt=""
        aria-hidden="true"
        sizes="44px"
        loading="eager"
      />
      <Image
        className="brand-logo-wordmark"
        src="/brand/maintenate-wordmark-outlined.png"
        width={2170}
        height={725}
        alt=""
        aria-hidden="true"
        sizes="176px"
        loading="eager"
      />
      <span className="visually-hidden">
        Maintenate — Machine maintenance. Clearer decisions.
      </span>
    </>
  );
}
