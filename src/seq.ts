import { array, IMonadPlus, KRoot, Maybe, maybe, monadPlus, object, pipe } from "@jsoldi/hkt";
import { DOMParser, Options } from "xmldom-qsa";

export type Seq<out T> = (node: Element) => (readonly [Element, T])[];

export interface KSeq extends KRoot {
    readonly 0: unknown
    readonly body: Seq<this[0]>
}

export type Text = string | null | undefined;
export type Struct = { readonly [K in keyof any]: Seq<any> };
export type Destruct<T extends Struct> = Seq<{ [K in keyof T]: T[K] extends Seq<infer A> ? A | undefined : never }>;
export type DestructAll<T extends Struct> = Seq<{ [K in keyof T]: T[K] extends Seq<infer A> ? A[] : never }>;

export interface ISeq extends IMonadPlus<KSeq> {
    readonly text: Seq<Text>
    readonly html: Seq<string>
    readonly href: Seq<Text>
    readonly get: Seq<Element>
    readonly set: (node: Element) => Seq<Element>
    readonly parentElement: Seq<HTMLElement>
    readonly closestElement: Seq<Element>
    gather<T>(f: (node: Element) => T): Seq<T>
    fromValues<A>(fun: (node: Element) => A[]): Seq<A>
    fromNodes<N extends Element>(fun: (node: Element) => N[]): Seq<N>
    closest<K extends keyof HTMLElementTagNameMap>(css: K): Seq<HTMLElementTagNameMap[K]>
    closest<E extends Element = Element>(css: string): Seq<E>
    select<K extends keyof HTMLElementTagNameMap>(css: K): Seq<HTMLElementTagNameMap[K]>
    select<E extends Element = Element>(css: string): Seq<E>
    selectText(css: string): Seq<Text>
    take<A>(n: number): (seq: Seq<A>) => Seq<A>
    first<A>(seq: Seq<A>): Seq<A>
    destructAll<T extends Struct>(t: T): DestructAll<T>
    destruct<T extends Struct>(t: T): Destruct<T>
    length(seq: Seq<unknown>): Seq<number>
    values<T>(seq: Seq<T>): Seq<T[]>
    elements(seq: Seq<any>): Seq<Element[]>
    maybe<A>(seq: Seq<A>): Seq<Maybe<A>>
    parse(html: string, options?: Options): <A>(seq: Seq<A>) => A[]
}

export const seq: ISeq = (() => {
    return pipe(
        {},
        _ => {
            const unit = <A>(value: A): Seq<A> => node => [[node, value]];
            const bind = <A, B>(seq: Seq<A>, fun: (a: A) => Seq<B>): Seq<B> => node => seq(node).flatMap(([innerNode, a]) => fun(a)(innerNode))
            const map = <A, B>(seq: Seq<A>, fun: (a: A) => B): Seq<B> => node => seq(node).map(([innerNode, a]) => [innerNode, fun(a)])
            const empty = <A>(): Seq<A> => _ => [];
            const append = <A>(left: Seq<A>, right: Seq<A>): Seq<A> => node => [...left(node), ...right(node)];

            const filter: {
                <T, S extends T>(predicate: (item: T) => item is S): (items: Seq<T>) => Seq<S>;
                <T>(predicate: (item: T) => boolean): (items: Seq<T>) => Seq<T>;
            } = <T>(predicate: (item: T) => boolean) => (items: Seq<T>) => (node: Element) => items(node).filter(([_, v]) => predicate(v));
        
            return monadPlus<KSeq>({ 
                unit, 
                bind, 
                map,
                empty,
                append,
                filter
            });
        },
        base => {
            const fromValues = <A>(fun: (node: Element) => A[]): Seq<A> => node => fun(node).map(a => [node, a]);
            const fromNodes = <N extends Element>(fun: (node: Element) => N[]): Seq<N> => node => fun(node).map(n => [n, n]);
            const gather = <T>(f: (node: Element) => T): Seq<T> => node => [[node, f(node)]];
            const text: Seq<Text> = node => [[node, node.textContent?.trim()]];
            const html: Seq<string> = node => [[node, node.toString()]];
            const href: Seq<Text> = node => [[node, node.getAttribute('href')]];
            const parentElement: Seq<HTMLElement> = node => node.parentElement ? [[node.parentElement, node.parentElement]] : [];
            const closestElement: Seq<Element> = node => (elem => elem ? [[elem, elem]] : [])(node.nodeType === 1 ? (node as Element) : node.parentElement);
            const select = <T extends Element = Element>(css: string): Seq<T> => fromNodes(node => [...node.querySelectorAll<T>(css)]);
            const selectText = (css: string) => base.bind(select(css), _ => text);
            const closest = (css: string): Seq<Element> => fromNodes(node => (n => n ? [n] : [])(node.closest(css)));
            const get: Seq<Element> = node => [[node, node]];
            const set = (node: Element): Seq<Element> => _ => [[node, node]];
            const take = (n: number) => <A>(seq: Seq<A>): Seq<A> => node => seq(node).slice(0, n);
            const first = <A>(seq: Seq<A>): Seq<A> => take(1)(seq);
            const length = (seq: Seq<unknown>): Seq<number> => node => [[node, seq(node).length]];
            const values = <T>(seq: Seq<T>): Seq<T[]> => node => [[node, seq(node).map(([_, v]) => v)]];
            const elements = (seq: Seq<any>): Seq<Element[]> => node => [[node, seq(node).map(([e, _]) => e)]];
            const _maybe = <A>(seq: Seq<A>): Seq<Maybe<A>> => base.map(values(seq), vs => maybe.fromList(vs));

            const destructAll = <T extends Struct>(t: T): DestructAll<T> => {
                return base.bind(get, node => {
                    const entries = Object.entries(t) as [keyof T, Seq<any>][];
                    
                    return base.pipe(
                        base.sequence(entries.map(([_, seq]) => base.bind(
                            set(node), 
                            _ => values(seq)
                        ))),
                        vs => _ => [[
                            node,
                            Object.fromEntries(
                                entries.map(([k], i) => [k, vs[i]])
                            )
                        ]]
                    ) as DestructAll<T>;
                });
            }

            const destruct = <T extends Struct>(t: T): Destruct<T> => {
                const lulz = base.map(destructAll(t), object.fmap(array.first));
                return lulz as Destruct<T>;
            }

            const parse = (html: string, options?: Options) => <A>(seq: Seq<A>) => seq(
                new DOMParser({
                    ...{ errorhandler: { warning: () => { }, error: () => { } } },
                    ...options
                }).parseFromString(html, 'text/xml').documentElement
            ).map(([_, v]) => v);

            return {
                ...base,
                fromValues,
                fromNodes,
                gather,
                text,
                html,
                href,
                parentElement,
                closestElement,
                select,
                selectText,
                closest,
                get,
                set,
                take,
                first,
                parse,
                destructAll,
                destruct,
                length,
                values,
                elements,
                maybe: _maybe
            };
        }
    )
})();
