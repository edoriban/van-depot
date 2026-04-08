import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terminos de Servicio - VanFlux',
  description:
    'Terminos y condiciones de uso del servicio VanFlux, sistema de gestion de inventario.',
};

export default function TerminosPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="mx-auto max-w-4xl px-6 py-4 flex items-center justify-between">
          <Link href="/login" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
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
        <h1 className="text-3xl font-bold mb-2">Terminos de Servicio</h1>
        <p className="text-muted-foreground mb-10">
          Ultima actualizacion: abril 2026
        </p>

        <div className="space-y-8 text-base leading-relaxed text-foreground/90">
          {/* 1 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">
              1. Aceptacion de los terminos
            </h2>
            <p>
              Al acceder o utilizar VanFlux (&quot;el Servicio&quot;), usted
              acepta quedar vinculado por estos Terminos de Servicio. Si no esta
              de acuerdo con alguna parte de estos terminos, no podra acceder al
              Servicio. El uso continuado de la plataforma despues de cualquier
              modificacion constituye la aceptacion de los terminos
              actualizados.
            </p>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">
              2. Descripcion del servicio
            </h2>
            <p>
              VanFlux es un sistema de gestion de inventario y almacen basado en
              la nube, desarrollado por VanDev. El Servicio permite a las
              empresas gestionar su inventario, rastrear movimientos de
              materiales, administrar almacenes y generar reportes operativos a
              traves de una interfaz web.
            </p>
          </section>

          {/* 3 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">
              3. Registro y cuentas
            </h2>
            <p className="mb-3">
              Para utilizar el Servicio, debe crear una cuenta proporcionando
              informacion veraz y completa. Usted es responsable de:
            </p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>
                Mantener la confidencialidad de sus credenciales de acceso
                (correo electronico y contrasena).
              </li>
              <li>
                Todas las actividades que ocurran bajo su cuenta.
              </li>
              <li>
                Notificar de inmediato a VanFlux sobre cualquier uso no
                autorizado de su cuenta.
              </li>
            </ul>
            <p className="mt-3">
              VanFlux se reserva el derecho de suspender o eliminar cuentas que
              violen estos terminos o que permanezcan inactivas por un periodo
              prolongado.
            </p>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">4. Uso aceptable</h2>
            <p className="mb-3">Al utilizar VanFlux, usted se compromete a:</p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>
                No utilizar el Servicio para fines ilegales o no autorizados.
              </li>
              <li>
                No compartir sus credenciales de acceso con terceros.
              </li>
              <li>
                No intentar acceder a areas restringidas del sistema o a cuentas
                de otros usuarios.
              </li>
              <li>
                No realizar acciones que puedan danar, deshabilitar o
                sobrecargar la infraestructura del Servicio.
              </li>
              <li>
                No utilizar herramientas automatizadas para extraer datos del
                Servicio sin autorizacion expresa.
              </li>
            </ul>
          </section>

          {/* 5 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">
              5. Propiedad intelectual
            </h2>
            <p>
              VanFlux, incluyendo su codigo fuente, diseno, logotipos, marcas y
              contenido, es propiedad exclusiva de VanDev. Estos terminos no le
              otorgan ningun derecho de propiedad intelectual sobre el Servicio.
              Queda prohibida la reproduccion, distribucion o modificacion del
              Servicio o cualquiera de sus componentes sin autorizacion previa
              por escrito.
            </p>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">
              6. Datos del usuario
            </h2>
            <p>
              Usted conserva todos los derechos sobre los datos de inventario,
              productos, movimientos y demas informacion que ingrese en la
              plataforma. VanFlux no reclamara propiedad sobre sus datos. Nos
              comprometemos a tratar su informacion conforme a nuestra{' '}
              <Link
                href="/privacidad"
                className="text-primary hover:text-primary/80 underline underline-offset-4"
              >
                Politica de Privacidad
              </Link>
              .
            </p>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">
              7. Disponibilidad del servicio
            </h2>
            <p>
              VanFlux se esfuerza por mantener el Servicio disponible de manera
              continua. Sin embargo, no garantizamos una disponibilidad del 100%.
              El Servicio puede experimentar interrupciones debido a
              mantenimiento programado, actualizaciones, o circunstancias fuera
              de nuestro control. Nos comprometemos a notificar con anticipacion
              cualquier mantenimiento planificado que pueda afectar la
              disponibilidad.
            </p>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">
              8. Limitacion de responsabilidad
            </h2>
            <p>
              En la medida maxima permitida por la ley aplicable, VanDev y sus
              afiliados no seran responsables por danos indirectos, incidentales,
              especiales, consecuentes o punitivos, incluyendo pero no limitado
              a: perdidas de datos, perdidas economicas derivadas de errores en
              el conteo de inventario, interrupciones del negocio, o cualquier
              otro dano intangible resultante del uso o la imposibilidad de uso
              del Servicio.
            </p>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">
              9. Modificaciones a los terminos
            </h2>
            <p>
              VanFlux se reserva el derecho de modificar estos Terminos de
              Servicio en cualquier momento. Las modificaciones entraran en vigor
              al momento de su publicacion en la plataforma. Es responsabilidad
              del usuario revisar periodicamente estos terminos. El uso
              continuado del Servicio despues de cualquier cambio constituye la
              aceptacion de los terminos modificados.
            </p>
          </section>

          {/* 10 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">10. Ley aplicable</h2>
            <p>
              Estos Terminos de Servicio se regiran e interpretaran de acuerdo
              con las leyes vigentes de los Estados Unidos Mexicanos. Cualquier
              controversia derivada del uso del Servicio sera sometida a la
              jurisdiccion de los tribunales competentes en Mexico.
            </p>
          </section>

          {/* 11 */}
          <section>
            <h2 className="text-xl font-semibold mb-3">11. Contacto</h2>
            <p>
              Si tiene preguntas o comentarios sobre estos Terminos de Servicio,
              puede contactarnos en:{' '}
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
        <div className="mx-auto max-w-4xl px-6 py-6 flex flex-col items-center gap-2 text-sm text-muted-foreground">
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
