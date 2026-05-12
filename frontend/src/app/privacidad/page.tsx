import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Politica de Privacidad - VanFlux',
  description:
    'Politica de privacidad de VanFlux. Conoce como recopilamos, usamos y protegemos tus datos personales.',
};

export default function PrivacidadPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="mx-auto max-w-4xl px-6 py-4 flex items-center justify-between">
          <Link href="/login" className="flex items-center gap-2">
            <Image
              src="/vanflux-icon.svg"
              alt="VanFlux"
              width={28}
              height={28}
            />
            <span className="font-semibold">VanFlux</span>
          </Link>
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            &larr; Volver al inicio
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-3xl font-semibold mb-2">Politica de Privacidad</h1>
        <p className="text-muted-foreground mb-10">
          Ultima actualizacion: abril 2026
        </p>

        <div className="space-y-8 text-base leading-relaxed text-foreground/90">
          {/* 1 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">
              1. Responsable del tratamiento
            </h2>
            <p>
              VanDev (&quot;nosotros&quot;, &quot;nuestro&quot;), con domicilio
              en Mexico, es el responsable del tratamiento de sus datos
              personales recopilados a traves de la plataforma VanFlux
              (&quot;el Servicio&quot;). Esta Politica de Privacidad describe
              como recopilamos, usamos, almacenamos y protegemos su informacion
              personal, en cumplimiento con la Ley Federal de Proteccion de
              Datos Personales en Posesion de los Particulares (LFPDPPP) y su
              Reglamento.
            </p>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">
              2. Datos personales que recopilamos
            </h2>
            <p className="mb-3">
              Para el funcionamiento del Servicio, recopilamos los siguientes
              datos personales:
            </p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>
                <strong>Datos de identificacion:</strong> nombre completo y
                correo electronico.
              </li>
              <li>
                <strong>Datos de cuenta:</strong> rol asignado dentro de la
                organizacion y permisos de acceso.
              </li>
              <li>
                <strong>Datos de actividad:</strong> historial de operaciones
                realizadas en la plataforma (movimientos de inventario, ajustes,
                transferencias).
              </li>
              <li>
                <strong>Datos tecnicos:</strong> direccion IP, tipo de
                navegador, sistema operativo y marcas de tiempo de acceso.
              </li>
            </ul>
          </section>

          {/* 3 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">
              3. Finalidades del tratamiento
            </h2>
            <p className="mb-3">
              Sus datos personales son tratados para las siguientes finalidades
              primarias:
            </p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>
                Autenticacion y verificacion de identidad para el acceso al
                Servicio.
              </li>
              <li>
                Gestion de permisos y roles dentro de la organizacion del
                usuario.
              </li>
              <li>
                Registro y trazabilidad de operaciones de inventario.
              </li>
              <li>Soporte tecnico y resolucion de incidencias.</li>
              <li>Mejora continua de la funcionalidad del Servicio.</li>
            </ul>
            <p className="mt-3">
              Como finalidades secundarias, podemos utilizar su informacion
              para enviar comunicaciones sobre actualizaciones del Servicio o
              nuevas funcionalidades. Usted puede oponerse a estas finalidades
              secundarias en cualquier momento contactandonos.
            </p>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">
              4. Datos que NO recopilamos
            </h2>
            <p className="mb-3">
              VanFlux no recopila los siguientes tipos de informacion:
            </p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>Datos financieros personales (tarjetas de credito, cuentas bancarias).</li>
              <li>Ubicacion GPS o geolocalizacion precisa.</li>
              <li>Datos biometricos.</li>
              <li>Informacion de redes sociales.</li>
              <li>Datos sensibles segun la LFPDPPP (origen etnico, estado de salud, creencias religiosas, orientacion sexual).</li>
            </ul>
          </section>

          {/* 5 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">5. Base legal</h2>
            <p>
              El tratamiento de sus datos personales se basa en el
              consentimiento que usted otorga al crear una cuenta en VanFlux y
              aceptar estos terminos. Para las finalidades primarias, el
              consentimiento es necesario para la prestacion del Servicio. Para
              las finalidades secundarias, el consentimiento es opcional y
              revocable en cualquier momento.
            </p>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">
              6. Transferencia y comparticion de datos
            </h2>
            <p>
              VanFlux no vende, alquila ni comparte sus datos personales con
              terceros con fines comerciales. Sus datos podran ser compartidos
              unicamente en los siguientes casos:
            </p>
            <ul className="list-disc pl-6 space-y-1.5 mt-3">
              <li>
                Cuando sea requerido por autoridad competente mediante orden
                judicial o requerimiento legal.
              </li>
              <li>
                Con proveedores de infraestructura tecnologica necesarios para
                operar el Servicio (hosting, bases de datos), quienes estan
                obligados contractualmente a proteger su informacion.
              </li>
            </ul>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">
              7. Medidas de seguridad
            </h2>
            <p className="mb-3">
              Implementamos medidas de seguridad administrativas, tecnicas y
              fisicas para proteger sus datos personales, incluyendo:
            </p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>Encriptacion de contrasenas mediante algoritmos seguros de hash.</li>
              <li>Autenticacion basada en tokens JWT con expiracion controlada.</li>
              <li>Comunicaciones cifradas mediante protocolo HTTPS/TLS.</li>
              <li>Control de acceso basado en roles (RBAC).</li>
              <li>Monitoreo de accesos y registro de actividad.</li>
            </ul>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">
              8. Retencion de datos
            </h2>
            <p>
              Sus datos personales seran conservados mientras su cuenta
              permanezca activa y durante un periodo de 6 meses posteriores a la
              eliminacion de la cuenta o solicitud de baja. Transcurrido este
              periodo, sus datos seran eliminados de manera segura de nuestros
              sistemas. Los datos de actividad anonimizados podran conservarse
              con fines estadisticos.
            </p>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">
              9. Derechos ARCO
            </h2>
            <p className="mb-3">
              De conformidad con la LFPDPPP, usted tiene derecho a ejercer sus
              derechos ARCO en cualquier momento:
            </p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>
                <strong>Acceso:</strong> conocer que datos personales tenemos
                sobre usted y como los utilizamos.
              </li>
              <li>
                <strong>Rectificacion:</strong> solicitar la correccion de sus
                datos cuando sean inexactos o esten incompletos.
              </li>
              <li>
                <strong>Cancelacion:</strong> solicitar la eliminacion de sus
                datos personales de nuestros registros.
              </li>
              <li>
                <strong>Oposicion:</strong> oponerse al tratamiento de sus datos
                para finalidades especificas.
              </li>
            </ul>
            <p className="mt-3">
              Para ejercer cualquiera de estos derechos, envie una solicitud a{' '}
              <a
                href="mailto:soporte@vanflux.com"
                className="text-primary hover:text-primary/80 underline underline-offset-4"
              >
                soporte@vanflux.com
              </a>{' '}
              indicando su nombre completo, correo electronico asociado a su
              cuenta, el derecho que desea ejercer y una descripcion clara de su
              solicitud. Daremos respuesta en un plazo maximo de 20 dias
              habiles.
            </p>
          </section>

          {/* 10 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">
              10. Cookies y almacenamiento local
            </h2>
            <p>
              VanFlux utiliza almacenamiento local del navegador (localStorage)
              para mantener su sesion activa y preferencias de la interfaz. No
              utilizamos cookies de rastreo, cookies de terceros ni tecnologias
              de seguimiento publicitario. La informacion almacenada localmente
              se limita a tokens de sesion y configuraciones de visualizacion.
            </p>
          </section>

          {/* 11 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">
              11. Cambios a esta politica
            </h2>
            <p>
              VanFlux se reserva el derecho de actualizar esta Politica de
              Privacidad en cualquier momento. Cualquier cambio significativo
              sera notificado a traves de la plataforma. La version vigente
              siempre estara disponible en esta pagina con su fecha de ultima
              actualizacion.
            </p>
          </section>

          {/* 12 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">12. Contacto</h2>
            <p>
              Si tiene preguntas sobre esta Politica de Privacidad o desea
              ejercer sus derechos ARCO, contactenos en:{' '}
              <a
                href="mailto:soporte@vanflux.com"
                className="text-primary hover:text-primary/80 underline underline-offset-4"
              >
                soporte@vanflux.com
              </a>
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t mt-16">
        <div className="mx-auto max-w-4xl p-6 flex flex-col items-center gap-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-3">
            <Link
              href="/terminos"
              className="hover:text-foreground transition-colors"
            >
              Terminos de Servicio
            </Link>
            <span aria-hidden="true">&middot;</span>
            <Link
              href="/privacidad"
              className="hover:text-foreground transition-colors"
            >
              Politica de Privacidad
            </Link>
          </div>
          <p>&copy; 2026 VanFlux. Todos los derechos reservados.</p>
        </div>
      </footer>
    </div>
  );
}
